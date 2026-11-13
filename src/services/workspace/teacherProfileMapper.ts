import { TeacherProfile } from '../../types';

export const LAST_TEACHER_EMAIL_KEY = 'docencia_last_teacher_email';
export const LAST_USER_PROFILE_KEY = 'docencia_last_user_profile';
export const SESSION_ACTIVE_STORAGE_KEY = 'docencia_session_active';
export const USER_PROFILE_STORAGE_KEY = 'docencia_user_profile';
export const TEACHER_EMAIL_STORAGE_KEY = 'docencia_teacher_email';
export const EXPLICIT_LOGOUT_STORAGE_KEY = 'docencia_explicit_logout';

export const DEFAULT_TEACHER_ID = 'user-docente';
export const DEFAULT_TEACHER_NAME = 'Docente Titular';
export const GENERIC_TEACHER_LABEL = 'Docente';
export const PROFESSOR_TITLE_PREFIX = 'Prof.';
export const DEFAULT_SCHOOL_NAME = 'Institución Educativa';
export const FDS_SCHOOL_DOMAIN = 'fds-esc.edu.ar';
export const FDS_SCHOOL_DISPLAY_NAME = 'FDS - Educación Secundaria';
export const LEGACY_PLACEHOLDER_AVATAR_FRAGMENT = 'photo-1534528741775';
export const UI_AVATARS_BASE_URL = 'https://ui-avatars.com/api/';
export const UI_AVATAR_BG_HEX = '1d4ed8';
export const UI_AVATAR_TEXT_HEX = 'ffffff';
export const UI_AVATAR_SIZE_PX = 150;

const PERSONAL_EMAIL_DOMAIN_FRAGMENTS = ['gmail.', 'hotmail.', 'outlook.', 'yahoo.'];

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.announcements',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/forms.body.readonly',
  'https://www.googleapis.com/auth/forms.responses.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export const BASIC_IDENTITY_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const DEFAULT_TEACHER_PERMISSIONS = [
  'tasks.create',
  'tasks.assign',
  'tasks.grade',
  'tasks.delete',
  'drive.read',
  'drive.attach',
  'classroom.sync',
  'students.view',
  'grades.manage',
];

/**
 * Obtiene el correo electrónico del docente con sesión activa en la pestaña actual.
 *
 * @returns El correo normalizado en minúsculas o `''` si no existe una sesión activa verificada.
 */
export const getActiveTeacherEmail = (): string => {
  if (typeof window === 'undefined') return '';
  if (sessionStorage.getItem(SESSION_ACTIVE_STORAGE_KEY) !== 'true') return '';
  return (sessionStorage.getItem(TEACHER_EMAIL_STORAGE_KEY) || '').trim().toLowerCase();
};

/**
 * Recupera el último correo electrónico recordado del docente entre `sessionStorage` y `localStorage`.
 * Se utiliza para pre-completar pistas de sesión (`login_hint`) sin asumir que la sesión siga abierta.
 *
 * @returns Correo electrónico normalizado o `''`.
 */
export const getLastRememberedEmail = (): string => {
  if (typeof window === 'undefined') return '';
  return (
    sessionStorage.getItem(TEACHER_EMAIL_STORAGE_KEY) ||
    localStorage.getItem(LAST_TEACHER_EMAIL_KEY) ||
    ''
  )
    .trim()
    .toLowerCase();
};

/**
 * Resuelve la URL del avatar del docente, descartando imágenes genéricas heredadas
 * y generando un avatar tipográfico con iniciales cuando no cuenta con foto de perfil de Google.
 *
 * @param teacherName Nombre visible del docente.
 * @param teacherEmail Correo electrónico como respaldo para derivar iniciales.
 * @param avatarUrl URL de imagen candidata (ej. `picture` de Google OAuth).
 * @returns URL válida de imagen para el avatar del perfil.
 */
export const getTeacherAvatar = (
  teacherName?: string,
  teacherEmail?: string,
  avatarUrl?: string
): string => {
  if (
    avatarUrl &&
    !avatarUrl.includes(LEGACY_PLACEHOLDER_AVATAR_FRAGMENT) &&
    avatarUrl.trim() !== ''
  ) {
    return avatarUrl;
  }
  const normalizedName =
    teacherName &&
    teacherName !== DEFAULT_TEACHER_NAME &&
    teacherName !== GENERIC_TEACHER_LABEL
      ? teacherName.replace(/^Prof\.\s*/i, '').trim()
      : '';
  const avatarSeed =
    normalizedName ||
    (teacherEmail ? teacherEmail.split('@')[0].replace(/[._-]/g, ' ') : GENERIC_TEACHER_LABEL);
  return `${UI_AVATARS_BASE_URL}?name=${encodeURIComponent(
    avatarSeed
  )}&background=${UI_AVATAR_BG_HEX}&color=${UI_AVATAR_TEXT_HEX}&bold=true&size=${UI_AVATAR_SIZE_PX}`;
};

/**
 * Infiere el nombre de la institución educativa a partir del dominio del correo del docente.
 *
 * @param emailAddress Correo electrónico institucional o personal del docente.
 * @returns Nombre legible de la institución asociada.
 */
export const deriveSchoolFromEmail = (emailAddress?: string): string => {
  if (!emailAddress || !emailAddress.includes('@')) return DEFAULT_SCHOOL_NAME;
  const emailDomain = emailAddress.split('@')[1].toLowerCase();
  if (emailDomain.includes(FDS_SCHOOL_DOMAIN)) {
    return FDS_SCHOOL_DISPLAY_NAME;
  }
  const isPersonalEmailDomain = PERSONAL_EMAIL_DOMAIN_FRAGMENTS.some((domainFragment) =>
    emailDomain.includes(domainFragment)
  );
  if (isPersonalEmailDomain) {
    return DEFAULT_SCHOOL_NAME;
  }
  const organizationShortName = emailDomain.split('.')[0];
  return `Institución ${organizationShortName.toUpperCase()}`;
};

export const DEFAULT_TEACHER: TeacherProfile = {
  id: DEFAULT_TEACHER_ID,
  name: DEFAULT_TEACHER_NAME,
  email: '',
  avatar: getTeacherAvatar(DEFAULT_TEACHER_NAME),
  role: DEFAULT_TEACHER_NAME,
  school: DEFAULT_SCHOOL_NAME,
  permissions: DEFAULT_TEACHER_PERMISSIONS,
  scopes: WORKSPACE_SCOPES,
};

/**
 * Persiste en `localStorage` el último perfil docente autenticado para agilizar futuros inicios de sesión.
 *
 * @param teacherProfile Perfil completo del docente autenticado.
 */
export const saveRememberedProfile = (teacherProfile: TeacherProfile): void => {
  if (typeof window === 'undefined' || !teacherProfile?.email) return;
  try {
    const normalizedEmail = teacherProfile.email.trim().toLowerCase();
    localStorage.setItem(LAST_TEACHER_EMAIL_KEY, normalizedEmail);
    localStorage.setItem(LAST_USER_PROFILE_KEY, JSON.stringify(teacherProfile));
  } catch (_) {}
};

/**
 * Construye un objeto `TeacherProfile` completo a partir de una dirección de correo electrónico,
 * formateando el nombre de usuario cuando no se provee un nombre explícito.
 *
 * @param emailAddress Correo electrónico del docente.
 * @param explicitDisplayName Nombre completo opcional reportado por el proveedor de identidad.
 * @returns Perfil docente estructurado con permisos y alcances por defecto.
 */
export const buildTeacherProfileFromEmail = (
  emailAddress: string,
  explicitDisplayName?: string
): TeacherProfile => {
  const normalizedEmail = emailAddress.trim().toLowerCase();
  const formattedLocalName =
    explicitDisplayName ||
    normalizedEmail
      .split('@')[0]
      .split(/[._-]/)
      .map((nameSegment) => nameSegment.charAt(0).toUpperCase() + nameSegment.slice(1))
      .join(' ') ||
    DEFAULT_TEACHER_NAME;
  const formattedProfessorName = formattedLocalName.startsWith(PROFESSOR_TITLE_PREFIX)
    ? formattedLocalName
    : `${PROFESSOR_TITLE_PREFIX} ${formattedLocalName}`;
  return {
    id: `teacher_${normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_')}`,
    name: formattedProfessorName,
    email: normalizedEmail,
    avatar: getTeacherAvatar(formattedProfessorName, normalizedEmail),
    role: DEFAULT_TEACHER_NAME,
    school: deriveSchoolFromEmail(normalizedEmail),
    permissions: DEFAULT_TEACHER.permissions,
    scopes: WORKSPACE_SCOPES,
  };
};

/**
 * Recupera el perfil docente almacenado en el navegador si coincide con el correo solicitado,
 * o reconstruye uno determinístico a partir del email.
 *
 * @param emailAddress Correo electrónico opcional a buscar.
 * @returns El perfil docente recuperado o `null` si no hay datos suficientes.
 */
export const getRememberedProfile = (emailAddress?: string): TeacherProfile | null => {
  if (typeof window === 'undefined') return null;
  const targetEmail = (emailAddress || getLastRememberedEmail() || '').trim().toLowerCase();
  try {
    const serializedProfile =
      sessionStorage.getItem(USER_PROFILE_STORAGE_KEY) ||
      localStorage.getItem(USER_PROFILE_STORAGE_KEY) ||
      localStorage.getItem(LAST_USER_PROFILE_KEY);
    if (serializedProfile) {
      const parsedProfile = JSON.parse(serializedProfile) as TeacherProfile;
      if (parsedProfile && parsedProfile.email) {
        if (!targetEmail || parsedProfile.email.trim().toLowerCase() === targetEmail) {
          return parsedProfile;
        }
      }
    }
  } catch (_) {}
  if (targetEmail && targetEmail.includes('@')) {
    return buildTeacherProfileFromEmail(targetEmail);
  }
  return null;
};
