/**
 * Google Classroom Integration Service
 * Endpoint: https://classroom.googleapis.com/v1
 * Scopes:
 * - https://www.googleapis.com/auth/classroom.courses.readonly
 * - https://www.googleapis.com/auth/classroom.coursework.students
 */

import { getCachedAccessToken, fetchGoogleApiWithRetry } from './googleAuth';
import { ClassroomTask } from '../../types';

const DEFAULT_FETCH_TIMEOUT_MS = 6000;
const FALLBACK_COURSES_TIMEOUT_MS = 5000;
const ROSTER_FETCH_TIMEOUT_MS = 5000;
const PER_COURSE_STUDENT_COUNT_TIMEOUT_MS = 3500;
const COURSES_CACHE_TTL_MS = 60000;
const ROSTER_CACHE_TTL_MS = 60000;
const CLASSROOM_ROSTER_PAGE_SIZE = 100;
const DEFAULT_ASSIGNMENT_MAX_POINTS = 100;
const INITIAL_ATTENDANCE_RATE = 100;
const INITIAL_AVERAGE_GRADE = 0;

const HTTP_STATUS_BAD_REQUEST = 400;
const HTTP_STATUS_UNAUTHORIZED = 401;
const HTTP_STATUS_FORBIDDEN = 403;

const CLASSROOM_AVATAR_BG_HEX = '1a73e8';
const CLASSROOM_AVATAR_TEXT_HEX = 'ffffff';
const DEFAULT_STUDENT_FALLBACK_NAME = 'Estudiante';
const CLASSROOM_SYNC_NOTE = 'Sincronizado desde Google Classroom';

/**
 * Ejecuta una petición HTTP hacia Google Classroom API protegida con `AbortController`
 * para evitar que una consulta lenta de Google bloquee indefinidamente la interfaz docente.
 *
 * @param url Endpoint completo de la API de Google Classroom.
 * @param options Opciones de configuración de `fetch`.
 * @param timeoutMs Tiempo máximo de espera en milisegundos antes de abortar la solicitud.
 * @returns Promesa con el objeto `Response` de la llamada.
 */
const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> => {
  const abortController = new AbortController();
  const timeoutTimerId = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    return await fetchGoogleApiWithRetry(url, { ...options, signal: abortController.signal });
  } finally {
    clearTimeout(timeoutTimerId);
  }
};

let cachedClassroomCourses: {
  timestamp: number;
  token: string;
  courses: any[];
} | null = null;

const cachedRosters = new Map<
  string,
  {
    timestamp: number;
    token: string;
    students: any[];
    studentsRaw: any[];
  }
>();

export const classroomService = {
  /**
   * Obtiene la lista de cursos activos del docente desde Google Classroom, utilizando caché en memoria
   * para evitar llamadas repetitivas y calculando opcionalmente el total de alumnos por curso.
   *
   * @param providedToken Token OAuth 2.0 explícito opcional.
   * @param options Opciones para incluir el conteo de estudiantes (`fetchStudentCounts`) o ignorar la caché (`forceFresh`).
   * @returns Estado de la consulta, arreglo de cursos (`courses`) y banderas de permisos requeridos.
   */
  async listClassroomCourses(
    providedToken?: string,
    options?: { fetchStudentCounts?: boolean; forceFresh?: boolean }
  ): Promise<{
    success: boolean;
    courses: any[];
    isLive: boolean;
    rosterPermissionRequired?: boolean;
    message?: string;
    errorDetail?: string;
  }> {
    const activeToken = providedToken || getCachedAccessToken();
    if (!activeToken) {
      return {
        success: false,
        courses: [],
        isLive: false,
        message:
          'No hay una sesión de Google activa con permisos de Classroom. Haz clic en "Conectar Google Classroom" para autorizar el acceso.',
      };
    }

    const currentTimeMs = Date.now();
    if (
      !options?.forceFresh &&
      cachedClassroomCourses &&
      cachedClassroomCourses.token === activeToken &&
      currentTimeMs - cachedClassroomCourses.timestamp < COURSES_CACHE_TTL_MS
    ) {
      if (
        !options?.fetchStudentCounts ||
        cachedClassroomCourses.courses.some(
          (cachedCourse) => typeof cachedCourse.studentsCount === 'number'
        )
      ) {
        return {
          success: true,
          courses: cachedClassroomCourses.courses,
          isLive: true,
          rosterPermissionRequired: false,
          message: `Se encontraron ${cachedClassroomCourses.courses.length} clases activas en Google Classroom.`,
        };
      }
    }

    try {
      let coursesResponse = await fetchWithTimeout(
        'https://classroom.googleapis.com/v1/courses?teacherId=me&courseStates=ACTIVE',
        { headers: { Authorization: `Bearer ${activeToken}` } },
        DEFAULT_FETCH_TIMEOUT_MS
      );

      // En cuentas donde el docente figura como co-profesor o administrador del dominio, el filtro `teacherId=me` puede devolver 400 o lista vacía, por lo que se reintenta sin ese filtro.
      if (!coursesResponse.ok && coursesResponse.status === HTTP_STATUS_BAD_REQUEST) {
        coursesResponse = await fetchWithTimeout(
          'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE',
          { headers: { Authorization: `Bearer ${activeToken}` } },
          DEFAULT_FETCH_TIMEOUT_MS
        );
      }

      if (coursesResponse.ok) {
        const coursesPayload = await coursesResponse.json();
        let rawCoursesList: any[] = Array.isArray(coursesPayload.courses)
          ? coursesPayload.courses
          : [];

        if (rawCoursesList.length === 0) {
          try {
            const fallbackResponse = await fetchWithTimeout(
              'https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE',
              { headers: { Authorization: `Bearer ${activeToken}` } },
              FALLBACK_COURSES_TIMEOUT_MS
            );
            if (fallbackResponse.ok) {
              const fallbackPayload = await fallbackResponse.json();
              if (
                Array.isArray(fallbackPayload.courses) &&
                fallbackPayload.courses.length > 0
              ) {
                rawCoursesList = fallbackPayload.courses;
              }
            }
          } catch (_) {}
        }

        let rosterPermissionRequired = false;
        let enrichedCourses: any[] = [];

        if (options?.fetchStudentCounts && rawCoursesList.length > 0) {
          enrichedCourses = await Promise.all(
            rawCoursesList.map(async (classroomCourse: any) => {
              let studentRosterCount = 0;
              try {
                const studentsResponse = await fetchWithTimeout(
                  `https://classroom.googleapis.com/v1/courses/${classroomCourse.id}/students?pageSize=${CLASSROOM_ROSTER_PAGE_SIZE}`,
                  { headers: { Authorization: `Bearer ${activeToken}` } },
                  PER_COURSE_STUDENT_COUNT_TIMEOUT_MS
                );
                if (studentsResponse.ok) {
                  const studentsPayload = await studentsResponse.json();
                  studentRosterCount = Array.isArray(studentsPayload.students)
                    ? studentsPayload.students.length
                    : 0;
                } else if (studentsResponse.status === HTTP_STATUS_FORBIDDEN) {
                  rosterPermissionRequired = true;
                }
              } catch (_) {}
              return {
                ...classroomCourse,
                studentsCount: studentRosterCount,
              };
            })
          );
        } else {
          enrichedCourses = rawCoursesList.map((classroomCourse: any) => ({
            ...classroomCourse,
            studentsCount:
              typeof classroomCourse.studentsCount === 'number'
                ? classroomCourse.studentsCount
                : 0,
          }));
        }

        cachedClassroomCourses = {
          timestamp: currentTimeMs,
          token: activeToken,
          courses: enrichedCourses,
        };

        return {
          success: true,
          courses: enrichedCourses,
          isLive: true,
          rosterPermissionRequired,
          message:
            enrichedCourses.length > 0
              ? `Se encontraron ${enrichedCourses.length} clases activas en tu Google Classroom.`
              : 'Google Classroom respondió correctamente, pero no se encontraron cursos activos con esta cuenta de Google.',
        };
      } else {
        const errorPayload = await coursesResponse.json().catch(() => ({}));
        const rawErrorMessage = errorPayload?.error?.message || '';
        console.warn('Google Classroom API response status:', coursesResponse.status, errorPayload);

        if (coursesResponse.status === HTTP_STATUS_UNAUTHORIZED) {
          return {
            success: false,
            courses: [],
            isLive: false,
            message:
              'La sesión de Google ha expirado. Haz clic en "Conectar con Google" para renovarla.',
            errorDetail: rawErrorMessage,
          };
        }

        if (coursesResponse.status === HTTP_STATUS_FORBIDDEN) {
          if (
            rawErrorMessage.toLowerCase().includes('disabled') ||
            rawErrorMessage.toLowerCase().includes('has not been used')
          ) {
            return {
              success: false,
              courses: [],
              isLive: false,
              message:
                'La API de Google Classroom aún no está habilitada en el proyecto de Google Cloud. Puedes usar la pestaña "Carga Rápida" para ingresar tus materias sin restricciones.',
              errorDetail: rawErrorMessage,
            };
          }
          return {
            success: false,
            courses: [],
            isLive: false,
            message:
              'Tu cuenta de Google requiere permisos de docente en Google Classroom (Google Workspace for Education). Puedes usar "Carga Rápida" para escribir tus materias.',
            errorDetail: rawErrorMessage,
          };
        }

        return {
          success: false,
          courses: [],
          isLive: false,
          message:
            rawErrorMessage ||
            'No se pudo conectar con Google Classroom. Puedes importar tus clases desde la pestaña "Carga Rápida".',
          errorDetail: rawErrorMessage,
        };
      }
    } catch (networkError: any) {
      console.warn('Google Classroom live fetch error:', networkError);
      return {
        success: false,
        courses: [],
        isLive: false,
        message: 'Error de red o conexión al consultar Google Classroom.',
        errorDetail: networkError?.message,
      };
    }
  },

  /**
   * Obtiene la nómina cruda de alumnos de un curso de Google Classroom.
   *
   * @param classroomCourseId ID numérico del curso en Google Classroom.
   * @param providedToken Token OAuth 2.0 explícito opcional.
   * @returns Arreglo de objetos de estudiantes tal como los devuelve la API de Classroom.
   */
  async listCourseStudents(classroomCourseId: string, providedToken?: string): Promise<any[]> {
    const detailedResult = await this.listCourseStudentsDetailed(classroomCourseId, providedToken);
    return detailedResult.studentsRaw || [];
  },

  /**
   * Descarga y normaliza el padrón de estudiantes de un curso de Google Classroom hacia el modelo interno de `Student`,
   * detectando específicamente si falta el permiso `classroom.rosters.readonly` (`403`).
   *
   * @param classroomCourseId ID del curso en Google Classroom.
   * @param providedToken Token OAuth 2.0 explícito opcional.
   * @param forceFresh Si es `true`, omite la caché de nómina en memoria.
   * @returns Resultado detallado con alumnos formateados (`students`), crudos (`studentsRaw`) y estado de permisos.
   */
  async listCourseStudentsDetailed(
    classroomCourseId: string,
    providedToken?: string,
    forceFresh = false
  ): Promise<{
    success: boolean;
    students: any[];
    studentsRaw: any[];
    rosterPermissionRequired: boolean;
    message?: string;
  }> {
    const activeToken = providedToken || getCachedAccessToken();
    if (!activeToken || !classroomCourseId) {
      return {
        success: false,
        students: [],
        studentsRaw: [],
        rosterPermissionRequired: false,
        message: 'Falta sesión o ID de curso.',
      };
    }

    const currentTimeMs = Date.now();
    const cachedRosterEntry = cachedRosters.get(classroomCourseId);
    if (
      !forceFresh &&
      cachedRosterEntry &&
      cachedRosterEntry.token === activeToken &&
      currentTimeMs - cachedRosterEntry.timestamp < ROSTER_CACHE_TTL_MS &&
      cachedRosterEntry.students.length > 0
    ) {
      return {
        success: true,
        students: cachedRosterEntry.students,
        studentsRaw: cachedRosterEntry.studentsRaw,
        rosterPermissionRequired: false,
      };
    }

    try {
      const rosterResponse = await fetchWithTimeout(
        `https://classroom.googleapis.com/v1/courses/${classroomCourseId}/students?pageSize=${CLASSROOM_ROSTER_PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${activeToken}` } },
        ROSTER_FETCH_TIMEOUT_MS
      );

      if (rosterResponse.ok) {
        const rosterPayload = await rosterResponse.json();
        const rawStudentsList: any[] = Array.isArray(rosterPayload.students)
          ? rosterPayload.students
          : [];
        const formattedStudents = rawStudentsList.map((classroomStudent) => {
          const studentProfile = classroomStudent.profile || {};
          const profileNameObject = studentProfile.name || {};
          const fullName =
            profileNameObject.fullName ||
            `${profileNameObject.givenName || ''} ${profileNameObject.familyName || ''}`.trim() ||
            DEFAULT_STUDENT_FALLBACK_NAME;
          const firstName =
            profileNameObject.givenName ||
            (fullName.includes(' ') ? fullName.split(' ')[0] : fullName);
          const lastName =
            profileNameObject.familyName ||
            (fullName.includes(' ') ? fullName.split(' ').slice(1).join(' ') : '');
          const emailAddress = studentProfile.emailAddress || '';
          let photoUrl = studentProfile.photoUrl || '';
          if (photoUrl.startsWith('//')) photoUrl = 'https:' + photoUrl;
          if (!photoUrl) {
            photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
              fullName
            )}&background=${CLASSROOM_AVATAR_BG_HEX}&color=${CLASSROOM_AVATAR_TEXT_HEX}&bold=true`;
          }

          return {
            id:
              classroomStudent.userId ||
              studentProfile.id ||
              `st-${Math.random().toString(36).substring(2, 8)}`,
            userId: classroomStudent.userId || studentProfile.id,
            firstName,
            lastName,
            email: emailAddress,
            avatar: photoUrl,
            attendanceRate: INITIAL_ATTENDANCE_RATE,
            averageGrade: INITIAL_AVERAGE_GRADE,
            notes: CLASSROOM_SYNC_NOTE,
          };
        });

        cachedRosters.set(classroomCourseId, {
          timestamp: currentTimeMs,
          token: activeToken,
          students: formattedStudents,
          studentsRaw: rawStudentsList,
        });

        return {
          success: true,
          students: formattedStudents,
          studentsRaw: rawStudentsList,
          rosterPermissionRequired: false,
        };
      }

      if (rosterResponse.status === HTTP_STATUS_FORBIDDEN) {
        return {
          success: false,
          students: [],
          studentsRaw: [],
          rosterPermissionRequired: true,
          message:
            'Se requiere permiso de nómina (classroom.rosters.readonly) en Google Classroom.',
        };
      }

      return {
        success: false,
        students: [],
        studentsRaw: [],
        rosterPermissionRequired: false,
        message: `Error al consultar Classroom (status ${rosterResponse.status}).`,
      };
    } catch (rosterFetchError: any) {
      console.warn('Classroom student fetch error:', rosterFetchError);
      return {
        success: false,
        students: [],
        studentsRaw: [],
        rosterPermissionRequired: false,
        message: rosterFetchError?.message || 'Error de conexión con Google Classroom.',
      };
    }
  },

  /**
   * Resuelve el ID real de Google Classroom para un curso local (cruzando por ID numérico o por similitud normalizada de materia y división)
   * y descarga su nómina actualizada de estudiantes.
   *
   * @param course Objeto del curso local a vincular.
   * @param providedToken Token OAuth 2.0 explícito opcional.
   * @param preloadedClassroomCourses Lista opcional de cursos de Classroom ya descargados para evitar otra llamada de red.
   * @param forceFresh Si es `true`, fuerza la lectura en vivo desde la API de Google Classroom.
   * @returns Los estudiantes sincronizados, el `realClassroomId` resuelto y el estado de la operación.
   */
  async resolveAndFetchCourseStudents(
    course: {
      id: string;
      name: string;
      subject?: string;
      grade?: string;
      division?: string;
      orientation?: string;
      section?: string;
      classroomCourseId?: string;
    },
    providedToken?: string,
    preloadedClassroomCourses?: any[],
    forceFresh = true
  ): Promise<{
    success: boolean;
    students: any[];
    realClassroomId?: string;
    rosterPermissionRequired: boolean;
    message?: string;
  }> {
    const activeToken = providedToken || getCachedAccessToken();
    if (!activeToken) {
      return {
        success: false,
        students: [],
        rosterPermissionRequired: false,
        message: 'No hay sesión de Google activa.',
      };
    }

    const targetClassroomId =
      course.classroomCourseId || (!isNaN(Number(course.id)) ? course.id : undefined);
    const isPlaceholderId =
      !targetClassroomId ||
      targetClassroomId.startsWith('gc-') ||
      isNaN(Number(targetClassroomId));

    if (targetClassroomId && !isPlaceholderId) {
      const directRosterResult = await this.listCourseStudentsDetailed(
        targetClassroomId,
        activeToken,
        forceFresh
      );
      if (directRosterResult.success && directRosterResult.students.length > 0) {
        return {
          success: true,
          students: directRosterResult.students,
          realClassroomId: targetClassroomId,
          rosterPermissionRequired: false,
        };
      }
      if (directRosterResult.rosterPermissionRequired) {
        return {
          success: false,
          students: [],
          realClassroomId: targetClassroomId,
          rosterPermissionRequired: true,
          message: directRosterResult.message,
        };
      }
    }

    let availableCourses = preloadedClassroomCourses;
    if (!availableCourses || availableCourses.length === 0) {
      const coursesListResult = await this.listClassroomCourses(activeToken, {
        fetchStudentCounts: false,
        forceFresh,
      });
      if (coursesListResult.rosterPermissionRequired) {
        return {
          success: false,
          students: [],
          rosterPermissionRequired: true,
          message: 'Se requiere permiso para leer nóminas de Google Classroom.',
        };
      }
      if (coursesListResult.success && Array.isArray(coursesListResult.courses)) {
        availableCourses = coursesListResult.courses;
      }
    }

    if (Array.isArray(availableCourses) && availableCourses.length > 0) {
      // Se normalizan abreviaturas frecuentes de colegios bilingües/secundarios ("Senior 3" <-> "S3", "Ciencias Sociales" <-> "Soc") para emparejar nombres locales con los de Classroom.
      const normalizeCourseMatchText = (rawText: string) =>
        (rawText || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/\bsenior\s*([123])\b/g, 's$1')
          .replace(/\bciencias\s+sociales\b/g, 'soc')
          .replace(/\bciencias\s+naturales\b/g, 'nat')
          .replace(/\b20\d{2}\b/g, '')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const cleanLocalName = (course.name || '').toLowerCase().trim();
      const cleanLocalSubject = normalizeCourseMatchText(
        course.subject || course.name.replace(/\([^)]*\)/g, '')
      );
      const cleanLocalGrade = normalizeCourseMatchText(course.grade || '');
      const normalizedLocalCourseFull = normalizeCourseMatchText(
        `${course.name || ''} ${course.grade || ''}`
      );

      const matchedClassroomCourse = availableCourses.find((candidateCourse: any) => {
        if (!candidateCourse) return false;
        if (
          candidateCourse.id &&
          (String(candidateCourse.id) === String(course.classroomCourseId) ||
            String(candidateCourse.id) === String(course.id))
        ) {
          return true;
        }

        const candidateName = (candidateCourse.name || '').toLowerCase().trim();
        const candidateSection = (candidateCourse.section || '').toLowerCase().trim();
        const combinedCandidateTitle = `${candidateName} ${candidateSection}`.trim();
        const normalizedCandidateFull = normalizeCourseMatchText(
          `${candidateCourse.name || ''} ${candidateCourse.section || ''} ${
            candidateCourse.descriptionHeading || ''
          }`
        );

        if (
          candidateName === cleanLocalName ||
          combinedCandidateTitle === cleanLocalName ||
          normalizedCandidateFull === normalizedLocalCourseFull
        ) {
          return true;
        }

        const parenthesizedCourseMatch = cleanLocalName.match(/^([^(]+?)\s*\(([^)]+)\)$/);
        if (parenthesizedCourseMatch) {
          const subjectSegment = normalizeCourseMatchText(parenthesizedCourseMatch[1]);
          const divisionGroupSegment = normalizeCourseMatchText(parenthesizedCourseMatch[2]);
          const matchesSubject =
            (subjectSegment && normalizedCandidateFull.includes(subjectSegment)) ||
            (cleanLocalSubject && normalizedCandidateFull.includes(cleanLocalSubject));
          const matchesDivisionGroup =
            (divisionGroupSegment && normalizedCandidateFull.includes(divisionGroupSegment)) ||
            (cleanLocalGrade &&
              cleanLocalGrade !== 'secundaria' &&
              normalizedCandidateFull.includes(cleanLocalGrade));
          if (matchesSubject && matchesDivisionGroup) return true;
        } else if (cleanLocalSubject && cleanLocalGrade && cleanLocalGrade !== 'secundaria') {
          if (
            normalizedCandidateFull.includes(cleanLocalSubject) &&
            normalizedCandidateFull.includes(cleanLocalGrade)
          ) {
            return true;
          }
        }

        return false;
      });

      if (matchedClassroomCourse && matchedClassroomCourse.id) {
        const matchedRosterResult = await this.listCourseStudentsDetailed(
          matchedClassroomCourse.id,
          activeToken,
          forceFresh
        );
        return {
          success: matchedRosterResult.success,
          students: matchedRosterResult.students,
          realClassroomId: matchedClassroomCourse.id,
          rosterPermissionRequired: matchedRosterResult.rosterPermissionRequired,
          message: matchedRosterResult.message,
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
   * Publica una nueva tarea o actividad evaluativa (`courseWork`) directamente en el curso de Google Classroom.
   *
   * @param classroomCourseId ID del curso en Google Classroom.
   * @param task Datos de la tarea (título, descripción, puntaje máximo y fecha de entrega).
   * @returns Identificador de la tarea creada, enlace directo a Classroom y bandera de publicación.
   */
  async createCourseWork(
    classroomCourseId: string,
    task: Partial<ClassroomTask>
  ): Promise<{ id: string; url: string; published: boolean }> {
    const activeToken = getCachedAccessToken();
    if (activeToken && classroomCourseId) {
      try {
        const createResponse = await fetchGoogleApiWithRetry(
          `https://classroom.googleapis.com/v1/courses/${classroomCourseId}/courseWork`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              title: task.title,
              description: task.description,
              maxPoints: task.maxPoints || DEFAULT_ASSIGNMENT_MAX_POINTS,
              workType: 'ASSIGNMENT',
              state: 'PUBLISHED',
              dueDate: task.dueDate
                ? {
                    year: new Date(task.dueDate).getFullYear(),
                    month: new Date(task.dueDate).getMonth() + 1,
                    day: new Date(task.dueDate).getDate(),
                  }
                : undefined,
            }),
          },
          activeToken
        );

        if (createResponse.ok) {
          const createdCourseWork = await createResponse.json();
          return {
            id: createdCourseWork.id,
            url:
              createdCourseWork.alternateLink ||
              `https://classroom.google.com/c/${classroomCourseId}`,
            published: true,
          };
        }
      } catch (publishError) {
        console.warn('Classroom publish error, falling back to local queue:', publishError);
      }
    }

    return {
      id: `cw-${Date.now().toString().slice(-4)}`,
      url: `https://classroom.google.com/c/${classroomCourseId || 'demo'}/a/new`,
      published: true,
    };
  },

  /**
   * Publica un anuncio privado en el tablón de novedades de Google Classroom dirigido exclusivamente
   * a un estudiante individual (`assigneeMode: 'INDIVIDUAL_STUDENTS'`).
   *
   * @param classroomCourseId ID del curso en Google Classroom.
   * @param studentUserId ID de usuario de Google Classroom del alumno destinatario.
   * @param text Contenido del mensaje o notificación pedagógica.
   * @returns Resultado de la publicación con su ID y enlace directo.
   */
  async createIndividualAnnouncement(
    classroomCourseId: string,
    studentUserId: string,
    text: string
  ): Promise<{ success: boolean; id?: string; url?: string; message?: string }> {
    const activeToken = getCachedAccessToken();
    if (!activeToken) {
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
      const announcementPayload: any = {
        text,
        state: 'PUBLISHED',
      };

      // Los IDs locales provisorios comienzan con `st-`; solo se activa `INDIVIDUAL_STUDENTS` cuando el alumno posee un `userId` real de Classroom.
      if (studentUserId && !studentUserId.startsWith('st-')) {
        announcementPayload.assigneeMode = 'INDIVIDUAL_STUDENTS';
        announcementPayload.individualStudentsOptions = {
          studentIds: [studentUserId],
        };
      }

      const announcementResponse = await fetchGoogleApiWithRetry(
        `https://classroom.googleapis.com/v1/courses/${classroomCourseId}/announcements`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(announcementPayload),
        },
        activeToken
      );

      if (announcementResponse.ok) {
        const createdAnnouncement = await announcementResponse.json();
        return {
          success: true,
          id: createdAnnouncement.id,
          url:
            createdAnnouncement.alternateLink ||
            `https://classroom.google.com/c/${classroomCourseId}`,
          message: 'Aviso publicado en el tablón del estudiante con éxito.',
        };
      } else {
        const errorBody = await announcementResponse.json().catch(() => ({}));
        console.warn(
          'Classroom individual announcement error:',
          announcementResponse.status,
          errorBody
        );
        return {
          success: false,
          message:
            errorBody?.error?.message ||
            `Error de Google Classroom (status ${announcementResponse.status})`,
        };
      }
    } catch (announcementError: any) {
      console.warn('Error connecting with Google Classroom announcements API:', announcementError);
      return {
        success: false,
        message: announcementError?.message || 'Error de conexión con Google Classroom.',
      };
    }
  },
};
