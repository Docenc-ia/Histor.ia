import { useState, useEffect, useMemo } from 'react';
import {
  Course,
  Student,
  StudentHistoryItem,
  AbsenceNotificationSettings,
  AbsencePresetTemplate,
} from '../types';
import { api } from '../services/api';
import { firestoreSync, getActiveUserId } from '../services/firestoreSync';

export const DEFAULT_ABSENCE_PRESETS: AbsencePresetTemplate[] = [
  {
    id: 'preset-standard',
    name: 'Aviso estándar de inasistencia',
    channel: 'any',
    category: 'Ausencia',
    text: 'Estimado/a {ESTUDIANTE}, te notificamos que se ha registrado una inasistencia en la materia {MATERIA} el día {FECHA}. Recuerda revisar el material de la clase y ponerte al día con las actividades solicitadas.',
    isDefault: true,
  },
  {
    id: 'preset-short',
    name: 'Aviso breve para ponerse al día',
    channel: 'any',
    category: 'Ausencia',
    text: 'Hola {ESTUDIANTE}, hoy {FECHA} se registró tu inasistencia en la clase de {MATERIA}. Por favor consulta con tus compañeros y en el aula virtual las tareas vistas en clase para no atrasarte.',
  },
  {
    id: 'preset-formal',
    name: 'Aviso formal con justificativo',
    channel: 'gmail',
    category: 'Ausencia',
    text: 'Estimado/a {ESTUDIANTE}:\n\nPor medio del presente te informamos que en la fecha {FECHA} se ha registrado una inasistencia en la asignatura {MATERIA}.\nTe recordamos presentar los justificativos correspondientes y consultar el material del aula virtual.\n\nSaludos cordiales,\nProfesor/a',
  },
  {
    id: 'preset-assignments',
    name: 'Aviso de tareas y trabajos prácticos',
    channel: 'classroom',
    category: 'Ausencia',
    text: 'Estimado/a {ESTUDIANTE}, registramos tu ausencia en la clase de {MATERIA} ({FECHA}). Es importante que revises el aula virtual para ponerte al día con las consignas y entregas programadas.',
  },
];

export const DEFAULT_CONDUCT_PRESETS: AbsencePresetTemplate[] = [
  {
    id: 'preset-conduct-standard',
    name: 'Aviso de llamado de atención / conducta',
    channel: 'any',
    category: 'Disposición',
    text: 'Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención por "{MOTIVO}" en la materia {MATERIA}, descontándose 1 punto en tu nota de disposición (Puntaje actual: {DISPOSICION}/10). Te solicitamos mantener las pautas de trabajo y convivencia acordadas para el aula.',
    isDefault: true,
  },
  {
    id: 'preset-conduct-material',
    name: 'Aviso de falta de material o compromiso',
    channel: 'any',
    category: 'Disposición',
    text: 'Hola {ESTUDIANTE}, en la clase de hoy ({FECHA}) en {MATERIA} registramos un llamado de atención por "{MOTIVO}" (-1 punto de disposición, nota actual: {DISPOSICION}/10). Recuerda traer los útiles necesarios y completar las actividades para la próxima clase.',
  },
  {
    id: 'preset-conduct-formal',
    name: 'Aviso formal a estudiante y familia (Gmail)',
    channel: 'gmail',
    category: 'Disposición',
    text: 'Estimado/a {ESTUDIANTE}:\n\nPor medio del presente te informamos que en la fecha {FECHA} durante la clase de {MATERIA} se ha registrado un llamado de atención por el motivo: "{MOTIVO}".\nComo consecuencia, tu registro de disposición de la materia queda en {DISPOSICION}/10 puntos.\nTe pedimos reflexionar y mejorar en este aspecto para no comprometer tu evaluación de cursada.\n\nAtentamente,\nProfesor/a',
  },
];

export const DEFAULT_REASON_TEMPLATES: Record<string, string> = {
  'Sin libro':
    'Estimado/a {ESTUDIANTE}, hoy {FECHA} se registró un llamado de atención por no traer el libro a la clase de {MATERIA} (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Recuerda traer el libro y los materiales requeridos para la próxima clase.',
  'Falta de tarea':
    'Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención en {MATERIA} por no presentar la tarea asignada (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Es fundamental realizar las actividades para acompañar tu proceso de aprendizaje.',
  'Uso indebido de celular':
    'Estimado/a {ESTUDIANTE}, en la clase de {MATERIA} de hoy {FECHA} se registró un llamado de atención por el uso de teléfono celular en el aula sin autorización (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Te solicitamos guardar los dispositivos durante la clase.',
  'Interrupción de clase':
    'Estimado/a {ESTUDIANTE}, hoy {FECHA} en {MATERIA} se registró un llamado de atención por interrupciones reiteradas al desarrollo de la clase (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Te pedimos colaborar activamente con el orden y las consignas de convivencia.',
  'Falta de materiales':
    'Hola {ESTUDIANTE}, hoy {FECHA} en {MATERIA} se registró un llamado de atención por no contar con los útiles y materiales indispensables de la clase (-1 punto de disposición, puntaje actual: {DISPOSICION}/10). Recuerda prepararlos con anticipación.',
  'Participación destacada':
    'Estimado/a {ESTUDIANTE}, ¡felicitaciones! Hoy {FECHA} sumaste 1 punto en tu nota de disposición en {MATERIA} por tu activa y valiosa participación en clase (Puntaje actual: {DISPOSICION}/10). ¡Excelente aporte!',
  'Excelente trabajo en clase':
    'Estimado/a {ESTUDIANTE}, te felicitamos por tu gran desempeño y compromiso durante la clase de {MATERIA} de hoy {FECHA} (+1 punto en disposición, puntaje actual: {DISPOSICION}/10). ¡A seguir así!',
  'Colaboración con compañeros':
    'Hola {ESTUDIANTE}, destacamos y agradecemos tu valiosa colaboración y compañerismo en la clase de {MATERIA} de hoy {FECHA} (+1 punto en disposición, puntaje actual: {DISPOSICION}/10). ¡Muy buen trabajo!',
  'Tarea y materiales completos':
    'Estimado/a {ESTUDIANTE}, felicitaciones por presentar tus actividades y materiales en forma completa e impecable hoy {FECHA} en {MATERIA} (+1 punto en disposición, puntaje actual: {DISPOSICION}/10).',
  'Compromiso y superación':
    'Estimado/a {ESTUDIANTE}, hoy {FECHA} en {MATERIA} reconocemos tu esfuerzo constante y superación personal (+1 punto en disposición, puntaje actual: {DISPOSICION}/10). ¡Felicitaciones por este logro!',
};

interface UseCourseNotificationsParams {
  teacherEmail: string;
  activeCourse?: Course;
  onShowToast: (msg: string, durationMs?: number) => void;
}

export function useCourseNotifications({
  teacherEmail,
  activeCourse,
  onShowToast,
}: UseCourseNotificationsParams) {
  const LOCAL_CONDUCT_OPTIONS_KEY = `fds_teacher_conduct_options_v2_${teacherEmail}`;
  const LOCAL_NOTIF_SETTINGS_KEY = `fds_absence_notif_settings_v1_${teacherEmail}`;
  const LOCAL_ABSENCE_PRESETS_KEY = `fds_absence_presets_v2_${teacherEmail}`;
  const LOCAL_REASON_TEMPLATES_KEY = `fds_conduct_reason_templates_v2_${teacherEmail}`;

  const [savedPresets, setSavedPresets] = useState<AbsencePresetTemplate[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_ABSENCE_PRESETS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const hasConduct = parsed.some((p: any) => p.category === 'Disposición');
            if (!hasConduct) {
              return [...parsed, ...DEFAULT_CONDUCT_PRESETS];
            }
            return parsed;
          }
        }
      } catch (_) {}
    }
    return [...DEFAULT_ABSENCE_PRESETS, ...DEFAULT_CONDUCT_PRESETS];
  });

  const [conductReasonTemplates, setConductReasonTemplates] = useState<Record<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_REASON_TEMPLATES_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            return { ...DEFAULT_REASON_TEMPLATES, ...parsed };
          }
        }
      } catch (_) {}
    }
    return DEFAULT_REASON_TEMPLATES;
  });

  const [notifSettings, setNotifSettings] = useState<AbsenceNotificationSettings>(() => {
    const defaultSettings: AbsenceNotificationSettings = {
      autoNotify: false,
      channel: 'classroom',
      templateClassroom:
        'Estimado/a {ESTUDIANTE}, te notificamos que se ha registrado una inasistencia en la materia {MATERIA} el día {FECHA}. Recuerda revisar el material de la clase y ponerte al día con las actividades solicitadas.',
      templateGmail:
        'Estimado/a {ESTUDIANTE},\n\nTe informamos que en la fecha {FECHA} se ha registrado una inasistencia en la clase de {MATERIA}.\n\nPor favor consulta con tus compañeros o en el aula virtual las tareas correspondientes para mantenerte al día.\n\nSaludos cordiales,\nProfesor/a',
      templateConductClassroom:
        'Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención por "{MOTIVO}" en la materia {MATERIA}, descontándose 1 punto en tu nota de disposición (Puntaje actual: {DISPOSICION}/10). Te solicitamos mantener las pautas de trabajo y convivencia acordadas para el aula.',
      templateConductGmail:
        'Estimado/a {ESTUDIANTE}:\n\nPor medio del presente te informamos que en la fecha {FECHA} durante la clase de {MATERIA} se ha registrado un llamado de atención por el motivo: "{MOTIVO}".\nComo consecuencia, tu registro de disposición de la materia queda en {DISPOSICION}/10 puntos.\nTe pedimos reflexionar y mejorar en este aspecto para no comprometer tu evaluación de cursada.\n\nAtentamente,\nProfesor/a',
      dontShowPopupOnAbsence: true,
      dontShowPopupOnDisposition: true,
    };

    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_NOTIF_SETTINGS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          return { ...defaultSettings, ...parsed, dontShowPopupOnAbsence: true };
        }
      } catch (_) {}
    }
    return defaultSettings;
  });

  const [teacherConductOptions, setTeacherConductOptions] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(LOCAL_CONDUCT_OPTIONS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (_) {}
    }
    return [];
  });

  // UI states for notification & conduct modals
  const [notifConfigActiveTab, setNotifConfigActiveTab] = useState<'reasons' | 'presets' | 'settings'>('reasons');
  const [searchReasonQuery, setSearchReasonQuery] = useState('');
  const [isNewReasonFormOpen, setIsNewReasonFormOpen] = useState(false);
  const [newReasonName, setNewReasonName] = useState('');
  const [newReasonTemplateText, setNewReasonTemplateText] = useState('');
  const [reasonCardDrafts, setReasonCardDrafts] = useState<Record<string, string>>({});
  const [isNotifConfigModalOpen, setIsNotifConfigModalOpen] = useState(false);
  const [newConfigPreset, setNewConfigPreset] = useState<{
    name: string;
    text: string;
    channel: 'classroom' | 'gmail' | 'any';
    category: 'Ausencia' | 'Disposición';
    isOpen: boolean;
  }>({
    name: '',
    text: '',
    channel: 'classroom',
    category: 'Ausencia',
    isOpen: false,
  });

  const [absenceNotifModal, setAbsenceNotifModal] = useState<{
    isOpen: boolean;
    historyItem: StudentHistoryItem | null;
    student: Student | null;
    channel: 'classroom' | 'gmail';
    messageText: string;
    selectedPresetId: string;
    showSavePresetInput: boolean;
    newPresetName: string;
    isSending: boolean;
  }>({
    isOpen: false,
    historyItem: null,
    student: null,
    channel: 'classroom',
    messageText: '',
    selectedPresetId: 'preset-standard',
    showSavePresetInput: false,
    newPresetName: '',
    isSending: false,
  });

  const [batchAbsenceModal, setBatchAbsenceModal] = useState<{
    isOpen: boolean;
    selectedItems: {
      historyItem: StudentHistoryItem;
      student: Student;
    }[];
    channel: 'classroom' | 'gmail';
    selectedPresetId: string;
    rawTemplateText: string;
    previewStudentIndex: number;
    previewStudentId?: string;
    showSavePresetInput: boolean;
    newPresetName: string;
    isSending: boolean;
    currentSendingStudentName?: string;
    progress?: number;
    total?: number;
    sendProgress: { current: number; total: number; currentStudentName: string } | null;
    useSmartTemplates: boolean;
    customPerItemMessages?: Record<string, string>;
  }>({
    isOpen: false,
    selectedItems: [],
    channel: 'classroom',
    selectedPresetId: 'preset-standard',
    rawTemplateText: '',
    previewStudentIndex: 0,
    previewStudentId: '',
    showSavePresetInput: false,
    newPresetName: '',
    isSending: false,
    currentSendingStudentName: '',
    progress: 0,
    total: 0,
    sendProgress: null,
    useSmartTemplates: true,
    customPerItemMessages: {},
  });

  const [editingConductOpt, setEditingConductOpt] = useState<string | null>(null);
  const [editConductInput, setEditConductInput] = useState('');
  const [editingTemplateForReason, setEditingTemplateForReason] = useState<string | null>(null);
  const [reasonTemplateDraft, setReasonTemplateDraft] = useState<string>('');
  const [saveReasonAsDefaultOnSend, setSaveReasonAsDefaultOnSend] = useState(true);
  const [isManageConductModalOpen, setIsManageConductModalOpen] = useState(false);
  const [newConductInput, setNewConductInput] = useState('');
  const [newConductType, setNewConductType] = useState<'subtract' | 'add'>('subtract');

  // Hydrate templates, presets, settings, and conduct options from backend & Firestore
  useEffect(() => {
    let isMounted = true;
    api
      .getConductTemplates(teacherEmail)
      .then((remoteTemplates) => {
        if (!isMounted) return;
        if (remoteTemplates && typeof remoteTemplates === 'object' && Object.keys(remoteTemplates).length > 0) {
          setConductReasonTemplates((prev) => {
            const merged = { ...prev, ...remoteTemplates };
            try {
              localStorage.setItem(LOCAL_REASON_TEMPLATES_KEY, JSON.stringify(merged));
            } catch (_) {}
            return merged;
          });
        }
      })
      .catch(() => {});

    api
      .getConductOptions(teacherEmail)
      .then((opts) => {
        if (!isMounted) return;
        if (Array.isArray(opts) && opts.length > 0) {
          setTeacherConductOptions(opts);
          try {
            localStorage.setItem(LOCAL_CONDUCT_OPTIONS_KEY, JSON.stringify(opts));
          } catch (_) {}
        }
      })
      .catch(() => {});

    const uid = getActiveUserId();
    if (uid) {
      firestoreSync
        .loadUserSetting<AbsencePresetTemplate[]>(uid, 'notification_presets')
        .then((cloudPresets) => {
          if (!isMounted || !Array.isArray(cloudPresets) || cloudPresets.length === 0) return;
          setSavedPresets((prev) => {
            const byId = new Map<string, AbsencePresetTemplate>();
            prev.forEach((p) => byId.set(p.id, p));
            cloudPresets.forEach((p) => {
              if (p && p.id && p.text) byId.set(p.id, p);
            });
            const merged = Array.from(byId.values());
            try {
              localStorage.setItem(LOCAL_ABSENCE_PRESETS_KEY, JSON.stringify(merged));
            } catch (_) {}
            return merged;
          });
        })
        .catch(() => {});

      firestoreSync
        .loadUserSetting<AbsenceNotificationSettings>(uid, 'notification_settings')
        .then((cloudSettings) => {
          if (!isMounted || !cloudSettings || typeof cloudSettings !== 'object') return;
          setNotifSettings((prev) => {
            const merged = { ...prev, ...cloudSettings };
            try {
              localStorage.setItem(LOCAL_NOTIF_SETTINGS_KEY, JSON.stringify(merged));
            } catch (_) {}
            return merged;
          });
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [teacherEmail]);

  const handleSavePreset = (
    name: string,
    text: string,
    channel: 'classroom' | 'gmail' | 'any' = 'any',
    category: 'all' | 'Ausencia' | 'Disposición' = 'all',
    associatedReason?: string
  ) => {
    const trimmed = name.trim() || `Plantilla personalizada ${savedPresets.length + 1}`;
    const newPreset: AbsencePresetTemplate = {
      id: `preset-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: trimmed,
      channel,
      category,
      associatedReason: associatedReason?.trim(),
      text,
      createdAt: Date.now(),
    };
    const updated = [...savedPresets, newPreset];
    setSavedPresets(updated);
    try {
      localStorage.setItem(LOCAL_ABSENCE_PRESETS_KEY, JSON.stringify(updated));
    } catch (_) {}
    const uid = getActiveUserId();
    if (uid) {
      firestoreSync.saveUserSetting(uid, 'notification_presets', updated).catch(() => {});
    }
    onShowToast(`Mensaje preestablecido "${trimmed}" guardado correctamente.`, 3500);
    return newPreset.id;
  };

  const handleDeletePreset = (presetId: string) => {
    if (savedPresets.length <= 1) {
      onShowToast('Debe mantenerse al menos un mensaje preestablecido.', 3000);
      return;
    }
    const updated = savedPresets.filter((p) => p.id !== presetId);
    setSavedPresets(updated);
    try {
      localStorage.setItem(LOCAL_ABSENCE_PRESETS_KEY, JSON.stringify(updated));
    } catch (_) {}
    const uid = getActiveUserId();
    if (uid) {
      firestoreSync.saveUserSetting(uid, 'notification_presets', updated).catch(() => {});
    }
    onShowToast('Plantilla eliminada.', 2500);
  };

  const formatTemplateForStudent = (
    template: string,
    student: Student | { firstName: string; lastName: string; id: string },
    courseName: string,
    disposition: number,
    date: string,
    motivo?: string,
    pointsChange?: number
  ) => {
    const studentName =
      student.firstName && student.lastName
        ? `${student.firstName} ${student.lastName}`
        : student.firstName || student.lastName || 'Estudiante';
    const pts = pointsChange !== undefined ? (pointsChange > 0 ? `+${pointsChange}` : `${pointsChange}`) : '1';
    const cleanMotivo = motivo ? motivo.replace(/^(\+|\[\+\])\s*/, '') : 'Conducta';
    return template
      .replace(/{(?:ALUMNO|ESTUDIANTE)}/g, studentName)
      .replace(/{MATERIA}/g, courseName)
      .replace(/{DISPOSICION}/g, `${disposition}`)
      .replace(/{FECHA}/g, date)
      .replace(/{(?:PUNTOS|DELTA)}/g, pts)
      .replace(/{(?:MOTIVO|ACCION|CONDUCTA)}/g, cleanMotivo);
  };

  const extractGenericTemplate = (
    text: string,
    student?: Student | { firstName: string; lastName: string; id: string } | null,
    courseName?: string,
    date?: string,
    motivo?: string,
    disposition?: number
  ) => {
    let tpl = text;
    if (student) {
      const full1 = `${student.firstName} ${student.lastName}`.trim();
      const full2 = `${student.lastName}, ${student.firstName}`.trim();
      if (full1 && tpl.includes(full1)) tpl = tpl.split(full1).join('{ESTUDIANTE}');
      if (full2 && tpl.includes(full2)) tpl = tpl.split(full2).join('{ESTUDIANTE}');
      if (student.firstName && student.firstName.trim().length > 2 && tpl.includes(student.firstName)) {
        tpl = tpl.split(student.firstName).join('{ESTUDIANTE}');
      }
    }
    if (courseName && tpl.includes(courseName)) {
      tpl = tpl.split(courseName).join('{MATERIA}');
    }
    if (date && tpl.includes(date)) {
      tpl = tpl.split(date).join('{FECHA}');
    }
    if (disposition !== undefined) {
      if (tpl.includes(`${disposition}/10`)) {
        tpl = tpl.split(`${disposition}/10`).join('{DISPOSICION}/10');
      }
    }
    if (motivo && tpl.includes(motivo)) {
      tpl = tpl.split(motivo).join('{MOTIVO}');
    }
    return tpl;
  };

  const getTemplateForReason = (reasonName: string, type: 'positive' | 'negative' = 'negative'): string => {
    const trimmed = (reasonName || '').trim();
    if (!trimmed) {
      return type === 'positive'
        ? DEFAULT_REASON_TEMPLATES['Participación destacada']
        : notifSettings.templateConductClassroom || DEFAULT_CONDUCT_PRESETS[0].text;
    }
    if (conductReasonTemplates[trimmed]) {
      return conductReasonTemplates[trimmed];
    }
    const lower = trimmed.toLowerCase();
    for (const [k, v] of Object.entries(conductReasonTemplates)) {
      if (k.toLowerCase() === lower) return v;
    }
    for (const [k, v] of Object.entries(DEFAULT_REASON_TEMPLATES)) {
      if (k.toLowerCase() === lower || lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower)) {
        return v;
      }
    }
    const isPositiveReason =
      type === 'positive' ||
      trimmed.startsWith('+') ||
      trimmed.startsWith('[+]') ||
      /^(felicitaci|participaci|excelente|destacad|compromiso|mérito|merito|buen comportamiento|tarea completa|superaci|colaboraci|ayud)/i.test(
        trimmed
      );

    const cleanReason = trimmed.replace(/^(\+|\[\+\])\s*/, '');
    if (isPositiveReason) {
      return `Estimado/a {ESTUDIANTE}, ¡felicitaciones! Hoy {FECHA} sumaste puntos a tu nota de disposición por "${cleanReason}" en la materia {MATERIA} (Puntaje actual: {DISPOSICION}/10). ¡Excelente trabajo, seguí así!`;
    }

    return `Estimado/a {ESTUDIANTE}, te notificamos que hoy {FECHA} se registró un llamado de atención por "${cleanReason}" en la materia {MATERIA}, descontándose 1 punto en tu nota de disposición (Puntaje actual: {DISPOSICION}/10). Te solicitamos mantener las pautas de trabajo y convivencia acordadas para el aula.`;
  };

  const handleSaveConductOptions = (newOptions: string[]) => {
    const cleaned = Array.from(new Set(newOptions.map((s) => s.trim()))).filter(Boolean);
    setTeacherConductOptions(cleaned);
    try {
      localStorage.setItem(LOCAL_CONDUCT_OPTIONS_KEY, JSON.stringify(cleaned));
    } catch (_) {}
    api.saveConductOptions(teacherEmail, cleaned).catch(() => {});
  };

  const handleAddConductOption = (newOpt: string) => {
    const trimmed = newOpt.trim();
    if (!trimmed) return;
    if (teacherConductOptions.includes(trimmed)) return;
    const updated = [...teacherConductOptions, trimmed];
    handleSaveConductOptions(updated);
    setNewConductInput('');
  };

  const handleDeleteConductOption = (optToDelete: string) => {
    const updated = teacherConductOptions.filter((o) => o !== optToDelete);
    handleSaveConductOptions(updated);
  };

  const handleEditConductOption = (oldOpt: string, newOpt: string) => {
    const trimmed = newOpt.trim();
    if (!trimmed || trimmed === oldOpt) {
      setEditingConductOpt(null);
      return;
    }
    const updated = teacherConductOptions.map((o) => (o === oldOpt ? trimmed : o));
    handleSaveConductOptions(updated);

    if (conductReasonTemplates[oldOpt]) {
      const updatedTpls = { ...conductReasonTemplates };
      updatedTpls[trimmed] = updatedTpls[oldOpt];
      delete updatedTpls[oldOpt];
      setConductReasonTemplates(updatedTpls);
      try {
        localStorage.setItem(LOCAL_REASON_TEMPLATES_KEY, JSON.stringify(updatedTpls));
      } catch (_) {}
      api.saveConductTemplates(teacherEmail, updatedTpls).catch(() => {});
    }

    setEditingConductOpt(null);
  };

  const handleSaveTemplateForReason = (
    reason: string,
    text: string,
    showToast = true,
    studentForContext?: Student | { firstName: string; lastName: string; id: string } | null
  ) => {
    const trimmed = (reason || '').trim();
    if (!trimmed || !text.trim()) return;

    const targetStudent = studentForContext || absenceNotifModal.student;
    const genericText = extractGenericTemplate(
      text,
      targetStudent,
      activeCourse?.name,
      absenceNotifModal.historyItem?.date,
      trimmed
    );

    const updated = {
      ...conductReasonTemplates,
      [trimmed]: genericText,
    };
    setConductReasonTemplates(updated);
    try {
      localStorage.setItem(LOCAL_REASON_TEMPLATES_KEY, JSON.stringify(updated));
    } catch (_) {}
    api.saveConductTemplates(teacherEmail, updated).catch(() => {});

    if (!teacherConductOptions.includes(trimmed)) {
      handleAddConductOption(trimmed);
    }

    if (showToast) {
      onShowToast(
        `✓ Plantilla guardada para "${trimmed}". La próxima vez que un alumno no traiga o registre esto, aparecerá este mensaje por defecto.`,
        4500
      );
    }
  };

  const handleResetTemplateForReason = (reason: string) => {
    const trimmed = (reason || '').trim();
    if (!trimmed) return;

    const updated = { ...conductReasonTemplates };
    delete updated[trimmed];
    setConductReasonTemplates(updated);
    try {
      localStorage.setItem(LOCAL_REASON_TEMPLATES_KEY, JSON.stringify(updated));
    } catch (_) {}
    api.saveConductTemplates(teacherEmail, updated).catch(() => {});

    onShowToast(`Mensaje de "${trimmed}" restablecido a la plantilla estándar.`, 3000);
  };

  const isReasonCustomized = (reasonName: string): boolean => {
    const trimmed = (reasonName || '').trim();
    if (!trimmed) return false;
    if (conductReasonTemplates[trimmed]) return true;
    const lower = trimmed.toLowerCase();
    return Object.keys(conductReasonTemplates).some((k) => k.toLowerCase() === lower);
  };

  const handleSaveNotifSettings = (newSettings: AbsenceNotificationSettings) => {
    setNotifSettings(newSettings);
    try {
      localStorage.setItem(LOCAL_NOTIF_SETTINGS_KEY, JSON.stringify(newSettings));
    } catch (_) {}
    const uid = getActiveUserId();
    if (uid) {
      firestoreSync.saveUserSetting(uid, 'notification_settings', newSettings).catch(() => {});
    }
    onShowToast('Configuración de avisos guardada correctamente.', 3000);
  };

  const allKnownReasonKeys = useMemo(() => {
    const set = new Set<string>();
    Object.keys(DEFAULT_REASON_TEMPLATES).forEach((k) => set.add(k.trim()));
    teacherConductOptions.forEach((o) => set.add(o.trim()));
    Object.keys(conductReasonTemplates).forEach((k) => set.add(k.trim()));
    return Array.from(set).filter(Boolean);
  }, [teacherConductOptions, conductReasonTemplates]);

  return {
    savedPresets,
    setSavedPresets,
    conductReasonTemplates,
    setConductReasonTemplates,
    notifSettings,
    setNotifSettings,
    teacherConductOptions,
    setTeacherConductOptions,
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
    handleSaveConductOptions,
    handleAddConductOption,
    handleDeleteConductOption,
    handleEditConductOption,
    handleSaveTemplateForReason,
    handleResetTemplateForReason,
    isReasonCustomized,
    handleSaveNotifSettings,
  };
}
