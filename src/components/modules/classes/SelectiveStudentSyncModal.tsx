import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Users,
  CheckSquare,
  Square,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  UserCheck,
  UserPlus,
  EyeOff,
  ShieldCheck,
  BookOpen,
} from 'lucide-react';
import { Course, Student } from '../../../types';
import {
  api,
  getLocalStudents,
  getRemovedStudentIds,
  getRemovedStudentsList,
  syncRemovedStudentsFromCloud,
} from '../../../services/api';
import { classroomService } from '../../../services/workspace/classroomService';
import { getCachedAccessToken } from '../../../services/workspace/googleAuth';

export interface SelectiveStudentSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetCourse: Course | null;
  allCourses?: Course[];
  token: string | null;
  userEmail?: string;
  onLoginWithGoogle?: (hintEmail?: string) => Promise<string | void>;
  isDarkMode: boolean;
  onSyncCompleted: (message: string) => void;
}

interface CandidateStudentItem {
  key: string;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string;
  statusInCourse: 'enrolled' | 'new' | 'removed';
  sourceLabel: 'classroom' | 'local';
}

export const SelectiveStudentSyncModal: React.FC<SelectiveStudentSyncModalProps> = ({
  isOpen,
  onClose,
  targetCourse,
  allCourses = [],
  token,
  userEmail,
  onLoginWithGoogle,
  isDarkMode,
  onSyncCompleted,
}) => {
  const [selectedCourseId, setSelectedCourseId] = useState<string>(targetCourse?.id || '');
  const [isLoadingCandidates, setIsLoadingCandidates] = useState<boolean>(false);
  const [isSavingSelection, setIsSavingSelection] = useState<boolean>(false);
  const [candidates, setCandidates] = useState<CandidateStudentItem[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterTab, setFilterTab] = useState<'all' | 'new' | 'enrolled' | 'removed'>('all');
  const [syncMode, setSyncMode] = useState<'merge' | 'replace'>('merge');
  const [realClassroomId, setRealClassroomId] = useState<string | undefined>(undefined);
  const [classroomCoursesList, setClassroomCoursesList] = useState<
    Array<{ id: string; name: string; section?: string }>
  >([]);
  const [selectedClassroomSourceId, setSelectedClassroomSourceId] = useState<string>('auto');
  const [statusNotice, setStatusNotice] = useState<{
    type: 'info' | 'warning' | 'success';
    text: string;
  } | null>(null);
  const [needsRosterPermission, setNeedsRosterPermission] = useState<boolean>(false);

  const activeTargetCourse = useMemo(() => {
    if (allCourses.length > 0 && selectedCourseId) {
      const found = allCourses.find((c) => c.id === selectedCourseId);
      if (found) return found;
    }
    return targetCourse;
  }, [allCourses, selectedCourseId, targetCourse]);

  useEffect(() => {
    if (isOpen && targetCourse?.id) {
      setSelectedCourseId(targetCourse.id);
      setSelectedClassroomSourceId('auto');
      setSearchQuery('');
      setFilterTab('all');
      setSyncMode('merge');
    }
  }, [isOpen, targetCourse?.id]);

  const loadCandidatesForCourse = async (
    courseToLoad: Course,
    overrideClassroomId?: string
  ) => {
    if (!courseToLoad?.id) return;
    setIsLoadingCandidates(true);
    setStatusNotice(null);
    setNeedsRosterPermission(false);

    try {
      await syncRemovedStudentsFromCloud(courseToLoad.id).catch(() => {});
      const currentEnrolled = getLocalStudents(courseToLoad.id);
      const removedIds = getRemovedStudentIds(courseToLoad.id);
      const removedObjs = getRemovedStudentsList(courseToLoad.id);
      const divisionCandidates = api.getDivisionCandidateStudentsForCourse(courseToLoad.id);

      const enrolledIds = new Set(currentEnrolled.map((s) => String(s.id).trim()));
      const enrolledEmails = new Set(
        currentEnrolled.map((s) => (s.email || '').trim().toLowerCase()).filter(Boolean)
      );
      const enrolledNames = new Set(
        currentEnrolled
          .map((s) => `${(s.firstName || '').trim()} ${(s.lastName || '').trim()}`.trim().toLowerCase())
          .filter(Boolean)
      );

      const isAlreadyEnrolled = (st: Partial<Student>) => {
        const sId = String(st.id || (st as any).userId || '').trim();
        const sEmail = (st.email || '').trim().toLowerCase();
        const sName = `${(st.firstName || '').trim()} ${(st.lastName || '').trim()}`.trim().toLowerCase();
        return (
          (sId && enrolledIds.has(sId)) ||
          (sEmail && enrolledEmails.has(sEmail)) ||
          Boolean(sName && enrolledNames.has(sName))
        );
      };

      const isPreviouslyRemoved = (st: Partial<Student>) => {
        const sId = String(st.id || (st as any).userId || '').trim();
        if (sId && removedIds.has(sId)) return true;
        const sName = `${(st.firstName || '').trim()} ${(st.lastName || '').trim()}`.trim().toLowerCase();
        return removedObjs.some((r) => {
          const rName = `${(r.firstName || '').trim()} ${(r.lastName || '').trim()}`.trim().toLowerCase();
          return (sId && r.id === sId) || Boolean(sName && rName === sName);
        });
      };

      let classroomStudents: Partial<Student>[] = [];
      let resolvedGcId: string | undefined = courseToLoad.classroomCourseId;
      const activeToken = token || getCachedAccessToken();

      if (activeToken) {
        classroomService
          .listClassroomCourses(activeToken, { fetchStudentCounts: false })
          .then((listRes) => {
            if (listRes.success && Array.isArray(listRes.courses)) {
              setClassroomCoursesList(
                listRes.courses.map((gc: any) => ({
                  id: String(gc.id),
                  name: gc.name || 'Curso de Classroom',
                  section: gc.section || gc.division || '',
                }))
              );
            }
          })
          .catch(() => {});

        const effectiveCourseForFetch: Course =
          overrideClassroomId && overrideClassroomId !== 'auto'
            ? { ...courseToLoad, classroomCourseId: overrideClassroomId }
            : courseToLoad;

        const res = await classroomService.resolveAndFetchCourseStudents(
          effectiveCourseForFetch,
          activeToken,
          undefined,
          true
        );

        if (res.rosterPermissionRequired) {
          setNeedsRosterPermission(true);
        }
        if (res.success && Array.isArray(res.students) && res.students.length > 0) {
          classroomStudents = res.students;
          resolvedGcId = res.realClassroomId || resolvedGcId;
        }
      }

      setRealClassroomId(resolvedGcId);

      const combinedMap = new Map<string, CandidateStudentItem>();

      const registerCandidate = (
        raw: Partial<Student>,
        sourceLabel: 'classroom' | 'local',
        idx: number
      ) => {
        const firstName = (raw.firstName || '').trim();
        const lastName = (raw.lastName || '').trim();
        if (!firstName && !lastName) return;

        const cleanEmail = (raw.email || '').trim().toLowerCase();
        const cleanName = `${firstName} ${lastName}`.trim().toLowerCase();
        const rawId = String(raw.id || (raw as any).userId || `cand-${idx}`).trim();

        for (const existing of Array.from(combinedMap.values())) {
          const exEmail = (existing.email || '').trim().toLowerCase();
          const exName = `${existing.firstName} ${existing.lastName}`.trim().toLowerCase();
          if (
            existing.id === rawId ||
            (cleanEmail && exEmail === cleanEmail) ||
            (cleanName && exName === cleanName)
          ) {
            if (sourceLabel === 'classroom' && existing.sourceLabel !== 'classroom') {
              existing.sourceLabel = 'classroom';
            }
            if (!existing.email && raw.email) existing.email = raw.email;
            return;
          }
        }

        const enrolled = isAlreadyEnrolled(raw);
        const removed = !enrolled && isPreviouslyRemoved(raw);
        const statusInCourse: 'enrolled' | 'new' | 'removed' = enrolled
          ? 'enrolled'
          : removed
          ? 'removed'
          : 'new';

        const fullName = `${firstName} ${lastName}`.trim();
        combinedMap.set(rawId, {
          key: rawId,
          id: rawId,
          firstName,
          lastName,
          email: raw.email || '',
          avatar:
            raw.avatar ||
            `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=1a73e8&color=ffffff&bold=true`,
          statusInCourse,
          sourceLabel,
        });
      };

      classroomStudents.forEach((st, idx) => registerCandidate(st, 'classroom', idx));
      divisionCandidates.forEach((st, idx) => registerCandidate(st, 'local', idx + 1000));
      currentEnrolled.forEach((st, idx) => registerCandidate(st, 'local', idx + 2000));

      const sortedList = Array.from(combinedMap.values()).sort((a, b) => {
        const cmp = (a.lastName || '').localeCompare(b.lastName || '', 'es', {
          sensitivity: 'base',
        });
        if (cmp !== 0) return cmp;
        return (a.firstName || '').localeCompare(b.firstName || '', 'es', {
          sensitivity: 'base',
        });
      });

      setCandidates(sortedList);

      const initialSelected = new Set<string>();
      const hasAnyEnrolled = sortedList.some((c) => c.statusInCourse === 'enrolled');
      for (const item of sortedList) {
        if (item.statusInCourse === 'enrolled') {
          initialSelected.add(item.key);
        } else if (item.statusInCourse === 'new' && !hasAnyEnrolled) {
          initialSelected.add(item.key);
        }
      }
      setSelectedKeys(initialSelected);

      if (classroomStudents.length > 0) {
        setStatusNotice({
          type: 'success',
          text: `Se encontraron ${classroomStudents.length} alumnos en Google Classroom para "${courseToLoad.name}". Elegí cuáles querés importar a esta materia.`,
        });
      } else if (sortedList.length > 0) {
        setStatusNotice({
          type: 'info',
          text: `Mostrando ${sortedList.length} alumnos disponibles del curso para "${courseToLoad.name}". Seleccioná los que cursan esta materia.`,
        });
      } else {
        setStatusNotice({
          type: 'warning',
          text: activeToken
            ? 'No se encontraron alumnos en el aula de Classroom vinculada. Podés elegir otro curso de origen arriba o reconectar tu cuenta.'
            : 'Conectá tu cuenta de Google Classroom para listar los estudiantes disponibles.',
        });
      }
    } catch (err) {
      console.warn('Error loading selective sync candidates:', err);
      setStatusNotice({
        type: 'warning',
        text: 'Hubo un inconveniente al consultar Google Classroom. Revisá tu conexión e intentá nuevamente.',
      });
    } finally {
      setIsLoadingCandidates(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTargetCourse) {
      loadCandidatesForCourse(
        activeTargetCourse,
        selectedClassroomSourceId !== 'auto' ? selectedClassroomSourceId : undefined
      );
    }
  }, [isOpen, activeTargetCourse?.id, selectedClassroomSourceId]);

  const filteredCandidates = useMemo(() => {
    return candidates.filter((item) => {
      if (filterTab === 'new' && item.statusInCourse !== 'new') return false;
      if (filterTab === 'enrolled' && item.statusInCourse !== 'enrolled') return false;
      if (filterTab === 'removed' && item.statusInCourse !== 'removed') return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const full1 = `${item.lastName} ${item.firstName}`.toLowerCase();
        const full2 = `${item.firstName} ${item.lastName}`.toLowerCase();
        const email = (item.email || '').toLowerCase();
        if (!full1.includes(q) && !full2.includes(q) && !email.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [candidates, filterTab, searchQuery]);

  const counts = useMemo(() => {
    let enrolled = 0;
    let newCount = 0;
    let removed = 0;
    for (const c of candidates) {
      if (c.statusInCourse === 'enrolled') enrolled++;
      else if (c.statusInCourse === 'new') newCount++;
      else if (c.statusInCourse === 'removed') removed++;
    }
    return {
      total: candidates.length,
      enrolled,
      newCount,
      removed,
    };
  }, [candidates]);

  if (!isOpen || !activeTargetCourse) return null;

  const toggleStudentKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      filteredCandidates.forEach((c) => next.add(c.key));
      return next;
    });
  };

  const handleDeselectAllVisible = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      filteredCandidates.forEach((c) => next.delete(c.key));
      return next;
    });
  };

  const handleSelectOnlyNewAndRemoved = () => {
    const next = new Set<string>();
    candidates.forEach((c) => {
      if (c.statusInCourse === 'new' || c.statusInCourse === 'removed') {
        next.add(c.key);
      }
    });
    setSelectedKeys(next);
  };

  const handleApplySelectiveSync = async () => {
    if (!activeTargetCourse) return;
    const selectedItems = candidates.filter((c) => selectedKeys.has(c.key));
    if (selectedItems.length === 0 && syncMode === 'merge') {
      setStatusNotice({
        type: 'warning',
        text: 'Seleccioná al menos un estudiante para importar a esta materia.',
      });
      return;
    }

    try {
      setIsSavingSelection(true);
      const res = await api.syncSelectedCourseStudents(
        activeTargetCourse.id,
        selectedItems.map((item) => ({
          id: item.id,
          courseId: activeTargetCourse.id,
          firstName: item.firstName,
          lastName: item.lastName,
          email: item.email,
          avatar: item.avatar,
        })),
        {
          mode: syncMode,
          allCandidates: candidates.map((c) => ({
            id: c.id,
            courseId: activeTargetCourse.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            avatar: c.avatar,
          })),
          realClassroomId,
        }
      );

      const summaryMsg =
        syncMode === 'replace'
          ? `¡Sincronización selectiva aplicada en "${activeTargetCourse.name}"! Nómina actualizada a ${res.count} estudiantes (sin afectar otras materias).`
          : `¡Importación selectiva completada en "${activeTargetCourse.name}"! Total en la materia: ${res.count} estudiantes (sin duplicados ni cambios en otras materias).`;

      onSyncCompleted(summaryMsg);
      onClose();
    } catch (err) {
      console.warn('Error applying selective student sync:', err);
      setStatusNotice({
        type: 'warning',
        text: 'Error al guardar los estudiantes seleccionados. Intentá nuevamente.',
      });
    } finally {
      setIsSavingSelection(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/65 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 ${
          isDarkMode
            ? 'bg-slate-900 border-slate-800 text-white'
            : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* CABECERA */}
        <div
          className={`px-6 py-4 border-b flex items-start justify-between gap-4 ${
            isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-neutral-200 bg-neutral-50/80'
          }`}
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                <ShieldCheck className="w-3.5 h-3.5" />
                Vinculación exclusiva por materia (courseId aislado)
              </span>
              <span
                className={`text-xs font-semibold ${
                  isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                }`}
              >
                Sin inserción automática en otras materias
              </span>
            </div>
            <h3 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-500 shrink-0" />
              <span>Sincronización Selectiva de Estudiantes</span>
            </h3>
            <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-600'}`}>
              Elegí exactamente qué estudiantes de Google Classroom querés importar a{' '}
              <strong className={isDarkMode ? 'text-white' : 'text-neutral-900'}>
                {activeTargetCourse.name}
              </strong>
              . Los cambios se aplican únicamente a esta materia.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`p-2 rounded-xl border transition-colors cursor-pointer ${
              isDarkMode
                ? 'border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                : 'border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* SELECTOR DE MATERIA DESTINO Y AULA DE CLASSROOM ORIGEN */}
        <div
          className={`px-6 py-3 border-b grid grid-cols-1 sm:grid-cols-2 gap-3 ${
            isDarkMode ? 'bg-slate-950/60 border-slate-800' : 'bg-neutral-50/60 border-neutral-200'
          }`}
        >
          <div>
            <label
              className={`block text-[11px] font-bold uppercase tracking-wider mb-1 ${
                isDarkMode ? 'text-slate-400' : 'text-neutral-500'
              }`}
            >
              1. Materia de destino en Docenc.ia
            </label>
            {allCourses.length > 1 ? (
              <select
                value={activeTargetCourse.id}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className={`w-full px-3 py-1.5 rounded-lg border text-xs font-semibold outline-none ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              >
                {allCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.grade || c.division || 'Curso'})
                  </option>
                ))}
              </select>
            ) : (
              <div
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-2 ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-800 text-blue-300'
                    : 'bg-white border-neutral-200 text-blue-800'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="truncate">{activeTargetCourse.name}</span>
              </div>
            )}
          </div>

          <div>
            <label
              className={`block text-[11px] font-bold uppercase tracking-wider mb-1 ${
                isDarkMode ? 'text-slate-400' : 'text-neutral-500'
              }`}
            >
              2. Aula de Google Classroom de origen
            </label>
            <div className="flex items-center gap-2">
              <select
                value={selectedClassroomSourceId}
                onChange={(e) => setSelectedClassroomSourceId(e.target.value)}
                className={`flex-1 px-3 py-1.5 rounded-lg border text-xs font-medium outline-none ${
                  isDarkMode
                    ? 'bg-slate-900 border-slate-700 text-slate-200'
                    : 'bg-white border-neutral-300 text-neutral-800'
                }`}
              >
                <option value="auto">
                  Detectar automáticamente para &quot;{activeTargetCourse.name}&quot;
                </option>
                {classroomCoursesList.map((gc) => (
                  <option key={gc.id} value={gc.id}>
                    {gc.name} {gc.section ? `(${gc.section})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() =>
                  loadCandidatesForCourse(
                    activeTargetCourse,
                    selectedClassroomSourceId !== 'auto' ? selectedClassroomSourceId : undefined
                  )
                }
                disabled={isLoadingCandidates}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                    : 'bg-white hover:bg-neutral-100 border-neutral-300 text-neutral-700'
                }`}
                title="Volver a consultar alumnos en Google Classroom"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCandidates ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Actualizar</span>
              </button>
            </div>
          </div>
        </div>

        {/* AVISO DE PERMISO GOOGLE CLASSROOM SI FALTA */}
        {needsRosterPermission && onLoginWithGoogle && (
          <div
            className={`mx-6 mt-3 p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
              isDarkMode
                ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                Para leer la lista en vivo desde Google Classroom se requiere autorizar la lectura de alumnos.
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await onLoginWithGoogle(userEmail);
                  setNeedsRosterPermission(false);
                  await loadCandidatesForCourse(activeTargetCourse);
                } catch (_) {}
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer shrink-0"
            >
              Autorizar Google Classroom
            </button>
          </div>
        )}

        {/* BANNER DE ESTADO */}
        {statusNotice && (
          <div
            className={`mx-6 mt-3 px-3.5 py-2.5 rounded-xl border text-xs flex items-center gap-2 ${
              statusNotice.type === 'success'
                ? isDarkMode
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : statusNotice.type === 'warning'
                ? isDarkMode
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
                : isDarkMode
                ? 'bg-blue-950/40 border-blue-800/60 text-blue-200'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}
          >
            {statusNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : statusNotice.type === 'warning' ? (
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 text-blue-500 shrink-0" />
            )}
            <span>{statusNotice.text}</span>
          </div>
        )}

        {/* CONTROLES DE FILTRO, BÚSQUEDA Y SELECCIÓN RÁPIDA */}
        <div className="px-6 pt-3 pb-2 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterTab('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  filterTab === 'all'
                    ? 'bg-blue-600 text-white'
                    : isDarkMode
                    ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                Todos ({counts.total})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('new')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  filterTab === 'new'
                    ? 'bg-emerald-600 text-white'
                    : isDarkMode
                    ? 'bg-slate-800 text-emerald-300 hover:bg-slate-700'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
              >
                Faltantes / Nuevos ({counts.newCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('enrolled')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                  filterTab === 'enrolled'
                    ? 'bg-indigo-600 text-white'
                    : isDarkMode
                    ? 'bg-slate-800 text-indigo-300 hover:bg-slate-700'
                    : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                }`}
              >
                Ya en la materia ({counts.enrolled})
              </button>
              {counts.removed > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterTab('removed')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    filterTab === 'removed'
                      ? 'bg-amber-600 text-white'
                      : isDarkMode
                      ? 'bg-slate-800 text-amber-300 hover:bg-slate-700'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                  }`}
                >
                  Ocultos en esta materia ({counts.removed})
                </button>
              )}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por apellido, nombre o correo..."
                className={`w-full pl-8 pr-3 py-1.5 rounded-lg border text-xs outline-none ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                    : 'bg-white border-neutral-300 text-neutral-900 placeholder:text-neutral-400'
                }`}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleSelectAllVisible}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer transition-colors ${
                  isDarkMode
                    ? 'border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200'
                    : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-700'
                }`}
              >
                Marcar todos ({filteredCandidates.length})
              </button>
              <button
                type="button"
                onClick={handleDeselectAllVisible}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer transition-colors ${
                  isDarkMode
                    ? 'border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200'
                    : 'border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-700'
                }`}
              >
                Desmarcar todos
              </button>
              {(counts.newCount > 0 || counts.removed > 0) && (
                <button
                  type="button"
                  onClick={handleSelectOnlyNewAndRemoved}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer transition-colors ${
                    isDarkMode
                      ? 'border-emerald-800/60 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300'
                      : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                  }`}
                >
                  Marcar solo faltantes / ocultos ({counts.newCount + counts.removed})
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className={isDarkMode ? 'text-slate-400' : 'text-neutral-500'}>Modo:</span>
              <select
                value={syncMode}
                onChange={(e) => setSyncMode(e.target.value as 'merge' | 'replace')}
                className={`px-2.5 py-1 rounded-lg border text-xs font-semibold outline-none ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-200'
                    : 'bg-white border-neutral-300 text-neutral-800'
                }`}
              >
                <option value="merge">
                  Agregar seleccionados a la materia (sin quitar actuales)
                </option>
                <option value="replace">
                  Dejar únicamente los seleccionados en esta materia
                </option>
              </select>
            </div>
          </div>
        </div>

        {/* LISTA DE ESTUDIANTES SELECCIONABLES */}
        <div className="flex-1 overflow-y-auto px-6 py-2 min-h-[260px]">
          {isLoadingCandidates ? (
            <div className="py-16 flex flex-col items-center justify-center gap-3 text-center">
              <RefreshCw className="w-7 h-7 text-blue-500 animate-spin" />
              <p className="text-sm font-semibold">
                Consultando estudiantes disponibles para {activeTargetCourse.name}...
              </p>
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="py-14 flex flex-col items-center justify-center gap-2 text-center">
              <Users className="w-8 h-8 text-neutral-400" />
              <p className="text-sm font-semibold">
                No hay estudiantes que coincidan con el filtro actual.
              </p>
              <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-neutral-500'}`}>
                Probá cambiar la pestaña de filtro o actualizar desde Google Classroom.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {filteredCandidates.map((item) => {
                const isChecked = selectedKeys.has(item.key);
                return (
                  <div
                    key={item.key}
                    onClick={() => toggleStudentKey(item.key)}
                    className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all select-none ${
                      isChecked
                        ? isDarkMode
                          ? 'bg-blue-950/35 border-blue-700/70 text-white'
                          : 'bg-blue-50/70 border-blue-300 text-neutral-900'
                        : isDarkMode
                        ? 'bg-slate-800/40 border-slate-800 text-slate-300 hover:bg-slate-800'
                        : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-blue-500 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-neutral-400 shrink-0" />
                      )}
                      <img
                        src={item.avatar}
                        alt={item.firstName}
                        className="w-8 h-8 rounded-full object-cover shrink-0 border border-neutral-200 dark:border-slate-700"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">
                          {item.lastName ? `${item.lastName}, ${item.firstName}` : item.firstName}
                        </p>
                        {item.email && (
                          <p
                            className={`text-[10px] truncate ${
                              isDarkMode ? 'text-slate-400' : 'text-neutral-500'
                            }`}
                          >
                            {item.email}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {item.statusInCourse === 'enrolled' && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isDarkMode
                              ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/60'
                              : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          }`}
                        >
                          <UserCheck className="w-3 h-3" /> En la materia
                        </span>
                      )}
                      {item.statusInCourse === 'new' && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isDarkMode
                              ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          <UserPlus className="w-3 h-3" /> Disponible
                        </span>
                      )}
                      {item.statusInCourse === 'removed' && (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isDarkMode
                              ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          <EyeOff className="w-3 h-3" /> Oculto
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* PIE DEL MODAL */}
        <div
          className={`px-6 py-4 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            isDarkMode ? 'border-slate-800 bg-slate-900/90' : 'border-neutral-200 bg-neutral-50'
          }`}
        >
          <div className="text-xs">
            <span className="font-bold text-blue-500">{selectedKeys.size}</span> de{' '}
            <span className="font-semibold">{candidates.length}</span> estudiantes seleccionados
            para <strong className="underline">{activeTargetCourse.name}</strong>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-4 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-colors ${
                isDarkMode
                  ? 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
              }`}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleApplySelectiveSync}
              disabled={isSavingSelection || isLoadingCandidates}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold shadow-xs cursor-pointer transition-all flex items-center gap-1.5"
            >
              {isSavingSelection ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Guardando en {activeTargetCourse.name}...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Aplicar selección en {activeTargetCourse.name} ({selectedKeys.size})
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
