import React from 'react';
import {
  BookOpen,
  Calendar,
  Check,
  Cloud,
  Database,
  Lock,
  Pencil,
  PenTool,
  Plus,
  Printer,
  Search,
  Settings,
  X,
  ArrowUpDown,
} from 'lucide-react';
import {
  AttendanceSettings,
  saveCourseAttendanceSettings,
} from '../../../utils/attendanceCalculations';
import { WEEKDAY_LABELS, extractWeekdaysFromSchedule } from '../../../utils/schoolHolidays';
import { isValidCourseSchedule } from '../../../utils/courseFormatting';
import { CloudSyncStatusInfo } from '../../../services/firestoreSync';
import { api } from '../../../services/api';
import { DriveSaveFormatSelector } from '../../common/DriveSaveFormatSelector';
import { DriveSaveFormat, SavedDriveFileResult } from '../../../utils/driveFormatExporters';
import {
  LibroDeTemasEntry,
  LibroDeTemasMetadata,
  ScheduledRow,
} from '../LibroDeTemasMatrix';

const SHORT_WEEKDAYS: Record<number, string> = {
  0: 'Dom',
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
};

export interface LibroDeTemasHeaderToolbarProps {
  courseId: string;
  courseName: string;
  courseSchedule?: string;
  todayStr: string;
  isDarkMode: boolean;
  stats: {
    totalScheduled: number;
    holidaysCount: number;
    effectiveClasses: number;
    completedClasses: number;
  };
  cloudStatus: CloudSyncStatusInfo;
  metadata: LibroDeTemasMetadata;
  setMetadata: React.Dispatch<React.SetStateAction<LibroDeTemasMetadata>>;
  entriesMap: Record<string, LibroDeTemasEntry>;
  characterOptions: string[];
  activeWeekdays: number[];
  activeWeekdaysLabel: string;
  scheduleSummaryText: string;
  isEditingScheduleConfig: boolean;
  setIsEditingScheduleConfig: React.Dispatch<React.SetStateAction<boolean>>;
  customScheduleInput: string;
  setCustomScheduleInput: React.Dispatch<React.SetStateAction<string>>;
  attendanceSettings: AttendanceSettings;
  onUpdateAttendanceSettings?: (next: AttendanceSettings) => void;
  onRefreshCourse?: () => void;
  onOpenAttendanceSettingsModal?: () => void;
  termFilter: 'all' | '1c' | '2c';
  setTermFilter: React.Dispatch<React.SetStateAction<'all' | '1c' | '2c'>>;
  sortOrder: 'asc' | 'desc';
  setSortOrder: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>;
  statusFilter: 'all' | 'completed' | 'pending' | 'holidays';
  setStatusFilter: React.Dispatch<
    React.SetStateAction<'all' | 'completed' | 'pending' | 'holidays'>
  >;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  scheduledRows: ScheduledRow[];
  handleSignAllCompletedClasses: () => void;
  setShowCharacterOptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAddDateModal: React.Dispatch<React.SetStateAction<boolean>>;
  handlePrintLibro: () => void;
  handleOpenOrDownloadBackup: () => void;
  handleSaveLibroInFormat: (
    format: DriveSaveFormat,
    customTitle: string
  ) => Promise<SavedDriveFileResult | null>;
  handleMetadataChange: (field: keyof LibroDeTemasMetadata, value: string) => void;
  handleToggleCourseWeekday: (day: number) => void;
  persistLibroData: (
    nextMetadata: LibroDeTemasMetadata,
    nextEntries: Record<string, LibroDeTemasEntry>,
    nextCharacterOptions?: string[],
    immediateCloud?: boolean
  ) => void;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
}

export const LibroDeTemasHeaderToolbar: React.FC<LibroDeTemasHeaderToolbarProps> = ({
  courseId,
  courseName,
  courseSchedule,
  todayStr,
  isDarkMode,
  stats,
  cloudStatus,
  metadata,
  setMetadata,
  entriesMap,
  characterOptions,
  activeWeekdays,
  activeWeekdaysLabel,
  scheduleSummaryText,
  isEditingScheduleConfig,
  setIsEditingScheduleConfig,
  customScheduleInput,
  setCustomScheduleInput,
  attendanceSettings,
  onUpdateAttendanceSettings,
  onRefreshCourse,
  onOpenAttendanceSettingsModal,
  termFilter,
  setTermFilter,
  sortOrder,
  setSortOrder,
  statusFilter,
  setStatusFilter,
  searchQuery,
  setSearchQuery,
  scheduledRows,
  handleSignAllCompletedClasses,
  setShowCharacterOptionsModal,
  setShowAddDateModal,
  handlePrintLibro,
  handleOpenOrDownloadBackup,
  handleSaveLibroInFormat,
  handleMetadataChange,
  handleToggleCourseWeekday,
  persistLibroData,
  setToastMsg,
}) => {
  return (
    <div
      className={`rounded-xl border overflow-hidden shadow-2xs transition-colors ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-neutral-200'
      }`}
    >
      {/* Encabezado: Título arriba y las 3 columnas de opciones debajo */}
      <div
        className={`p-3 sm:p-4 border-b flex flex-col gap-3.5 min-w-0 ${
          isDarkMode ? 'bg-slate-850 border-slate-800' : 'bg-stone-50 border-neutral-200'
        }`}
      >
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-500/20 shrink-0">
            <BookOpen className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2 flex-wrap min-w-0 flex-1">
            <h3 className="text-sm font-bold text-neutral-900 dark:text-white tracking-tight">
              Libro de Temas Oficial
            </h3>
            <span
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border max-w-full truncate ${
                isDarkMode
                  ? 'bg-blue-950/60 border-blue-800 text-blue-300'
                  : 'bg-blue-50 border-blue-200 text-blue-700'
              }`}
            >
              {stats.completedClasses} / {stats.effectiveClasses} clases registradas
            </span>
            {stats.holidaysCount > 0 && (
              <span
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border max-w-full truncate ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-slate-300'
                    : 'bg-neutral-100 border-neutral-200 text-neutral-600'
                }`}
              >
                {stats.holidaysCount} sin dictado (feriados / eventos)
              </span>
            )}
            <span
              className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
                cloudStatus.state === 'syncing'
                  ? isDarkMode
                    ? 'bg-blue-950/60 border-blue-800 text-blue-300'
                    : 'bg-blue-50 border-blue-200 text-blue-700'
                  : cloudStatus.state === 'offline'
                  ? isDarkMode
                    ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                  : isDarkMode
                  ? 'bg-emerald-950/50 border-emerald-800/70 text-emerald-300'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
              title="Todo cambio que escribas en el Libro de Temas se guarda automáticamente en el dispositivo y en tu cuenta en la nube"
            >
              <Cloud className={`w-3 h-3 shrink-0 ${cloudStatus.state === 'syncing' ? 'animate-pulse' : ''}`} />
              <span>
                {cloudStatus.state === 'syncing'
                  ? 'Guardando cambios...'
                  : cloudStatus.state === 'offline'
                  ? 'Guardado local (sin red)'
                  : `✓ Guardado automático${cloudStatus.lastSyncedAt ? ` (${cloudStatus.lastSyncedAt})` : ''}`}
              </span>
            </span>
          </div>
        </div>

        {/* 2 Columnas de 3 Opciones debajo del título y arriba de Asignatura, Prof. Titular, etc. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full min-w-0 pt-2 border-t border-neutral-200/70 dark:border-slate-800">
          {/* COLUMNA 1: Firmar clases cargadas, Opciones de carácter y Agregar Fecha */}
          <div className="flex flex-col gap-1.5 min-w-0">
            <button
              type="button"
              onClick={handleSignAllCompletedClasses}
              className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
              }`}
              title="Estampar la firma del profesor en todas las clases que ya tienen contenidos cargados"
            >
              <PenTool className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="truncate">Firmar clases cargadas</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCharacterOptionsModal(true)}
              className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
              }`}
              title="Personalizar las opciones del desplegable Carácter de la clase"
            >
              <Settings className="w-3.5 h-3.5 text-purple-500 shrink-0" />
              <span className="truncate">Opciones de carácter</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAddDateModal(true)}
              className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
              }`}
              title="Agregar una fecha especial o clase adicional fuera de los días habituales"
            >
              <Plus className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="truncate">Agregar Fecha</span>
            </button>
          </div>

          {/* COLUMNA 2: Imprimir, Copia de Seguridad y Guardar en Drive */}
          <div className="flex flex-col gap-1.5 min-w-0 sm:border-l sm:pl-2.5 border-neutral-200 dark:border-slate-800">
            <button
              type="button"
              onClick={handlePrintLibro}
              className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 border-slate-700 text-slate-200'
                  : 'bg-white hover:bg-neutral-100 border-neutral-200 text-neutral-700'
              }`}
              title="Imprimir folio del Libro de Temas en formato horizontal"
            >
              <Printer className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="truncate">Imprimir</span>
            </button>

            <button
              type="button"
              onClick={handleOpenOrDownloadBackup}
              className={`w-full min-w-0 inline-flex items-center justify-center sm:justify-start gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                isDarkMode
                  ? 'bg-slate-800 hover:bg-slate-750 text-indigo-300 border-indigo-900/60 hover:border-indigo-700'
                  : 'bg-white hover:bg-indigo-50/60 text-indigo-700 border-indigo-200'
              }`}
              title="Copia de seguridad local: Descargar respaldo o restaurar Libro de Temas y datos del curso"
            >
              <Database className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="truncate">Copia de Seguridad</span>
            </button>

            <div className="w-full min-w-0 [&>div]:w-full [&>div>button]:w-full [&>div>button]:justify-center sm:[&>div>button]:justify-start">
              <DriveSaveFormatSelector
                courseName={courseName}
                category="Libro de Temas"
                defaultTitle={`Libro de Temas - ${courseName} (${todayStr})`}
                buttonLabel="Guardar en Drive"
                compact
                onSaveFormat={handleSaveLibroInFormat}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Campos del Encabezado del Libro de Temas: ASIGNATURA, PROF. TITULAR, DÍAS DE CLASE y CALENDARIO ESCOLAR Y FERIADOS */}
      <div
        className={`p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-3 border-b min-w-0 ${
          isDarkMode
            ? 'bg-slate-900/90 border-slate-800'
            : 'bg-amber-50/20 border-neutral-200'
        }`}
      >
        <div className="sm:col-span-1 xl:col-span-3 min-w-0">
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
            ASIGNATURA:
          </label>
          <input
            type="text"
            value={metadata.asignatura}
            onChange={(e) => handleMetadataChange('asignatura', e.target.value)}
            placeholder="Ej: Historia 2° Año"
            className={`w-full min-w-0 px-3 py-1.5 rounded-lg border text-xs font-bold focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white'
                : 'bg-white border-neutral-300 text-neutral-900'
            }`}
          />
        </div>

        <div className="sm:col-span-1 xl:col-span-3 min-w-0">
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
            PROF. TITULAR:
          </label>
          <input
            type="text"
            value={metadata.profTitular}
            onChange={(e) => handleMetadataChange('profTitular', e.target.value)}
            placeholder="Nombre y Apellido del docente"
            className={`w-full min-w-0 px-3 py-1.5 rounded-lg border text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-white'
                : 'bg-white border-neutral-300 text-neutral-900'
            }`}
          />
        </div>

        <div className="sm:col-span-2 xl:col-span-6 min-w-0">
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-neutral-500 dark:text-slate-400 mb-1">
            DÍAS DE CLASE:
          </label>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <div className="flex-1 min-w-[200px] max-w-full">
              {!isEditingScheduleConfig ? (
                <div
                  className={`w-full px-3 py-1.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 min-w-0 ${
                    isDarkMode
                      ? 'bg-slate-800 border-slate-700 text-slate-200'
                      : 'bg-white border-neutral-300 text-neutral-800'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Lock className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400 truncate">
                        {activeWeekdaysLabel}
                      </span>
                      {scheduleSummaryText && (
                        <span className="text-[10px] font-medium text-neutral-500 dark:text-slate-400 truncate">
                          {scheduleSummaryText}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const initialSched = isValidCourseSchedule(courseSchedule)
                        ? courseSchedule!
                        : isValidCourseSchedule(metadata.horario)
                        ? metadata.horario
                        : activeWeekdays.map((d) => WEEKDAY_LABELS[d] || SHORT_WEEKDAYS[d]).join(', ');
                      setCustomScheduleInput(initialSched);
                      setIsEditingScheduleConfig(true);
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold border transition-colors cursor-pointer shrink-0 ${
                      isDarkMode
                        ? 'border-slate-600 bg-slate-700/80 text-slate-200 hover:bg-slate-700'
                        : 'border-neutral-200 bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                    title="Modificar los días y horas de cursada"
                  >
                    <Pencil className="w-3 h-3 text-blue-500 shrink-0" />
                    <span>Editar</span>
                  </button>
                </div>
              ) : (
                <div
                  className={`w-full p-2.5 rounded-lg border space-y-2 min-w-0 ${
                    isDarkMode
                      ? 'bg-slate-800 border-blue-500/60 text-slate-200'
                      : 'bg-white border-blue-400 text-neutral-800'
                  }`}
                >
                  {/* Días de la semana */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase text-neutral-500 dark:text-slate-400">
                      Días de cursada:
                    </span>
                    <div className="inline-flex items-center gap-1 flex-wrap min-w-0">
                      {[
                        { day: 1, label: 'Lun' },
                        { day: 2, label: 'Mar' },
                        { day: 3, label: 'Mié' },
                        { day: 4, label: 'Jue' },
                        { day: 5, label: 'Vie' },
                      ].map((d) => {
                        const isSelected = activeWeekdays.includes(d.day);
                        return (
                          <button
                            key={d.day}
                            type="button"
                            onClick={() => handleToggleCourseWeekday(d.day)}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                                : isDarkMode
                                ? 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                                : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Horarios específicos por día (cada hora genera una fila) */}
                  <div className="space-y-1.5 pt-1 border-t border-neutral-200 dark:border-slate-700/60">
                    <div className="flex items-center justify-between gap-1 flex-wrap">
                      <span className="text-[10px] font-bold uppercase text-neutral-500 dark:text-slate-400">
                        Horario (cada hora es una fila en la tabla):
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const daysNames = activeWeekdays.map((d) => WEEKDAY_LABELS[d] || SHORT_WEEKDAYS[d]);
                          const formatted = daysNames
                            .map((dn) => `${dn} 07:50 - 08:50, ${dn} 08:50 - 09:50`)
                            .join(', ');
                          setCustomScheduleInput(formatted);
                        }}
                        className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline font-bold cursor-pointer"
                      >
                        Usar 2 horas (07:50 - 08:50 y 08:50 - 09:50)
                      </button>
                    </div>

                    <input
                      type="text"
                      value={customScheduleInput}
                      onChange={(e) => setCustomScheduleInput(e.target.value)}
                      placeholder="Ej: Jueves 07:50 - 08:50, Jueves 08:50 - 09:50"
                      className={`w-full px-2.5 py-1 text-xs rounded-md border font-medium focus:outline-hidden ${
                        isDarkMode
                          ? 'bg-slate-900 border-slate-700 text-white'
                          : 'bg-neutral-50 border-neutral-300 text-neutral-900'
                      }`}
                    />
                    <p className="text-[10px] text-neutral-500 dark:text-slate-400">
                      Si tenés 2 horas un día (ej: 7:50 a 8:50 y 8:50 a 9:50), se generan automáticamente 2 filas en el Libro de Temas.
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingScheduleConfig(false)}
                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-neutral-500 dark:text-slate-400 hover:text-neutral-700 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const rawInput = customScheduleInput.trim();
                        const inputWeekdays = extractWeekdaysFromSchedule(rawInput);
                        const finalWeekdays = inputWeekdays.length > 0 ? inputWeekdays : activeWeekdays;

                        let scheduleToSave = rawInput;
                        if (!isValidCourseSchedule(rawInput)) {
                          scheduleToSave = finalWeekdays.map((d) => WEEKDAY_LABELS[d]).join(', ');
                        } else if (inputWeekdays.length === 0 && /\d{1,2}:\d{2}/.test(rawInput)) {
                          // El docente seleccionó los días arriba con los botones y escribió solo las horas abajo
                          scheduleToSave = finalWeekdays
                            .map((d) => `${WEEKDAY_LABELS[d] || SHORT_WEEKDAYS[d]} ${rawInput}`)
                            .join(', ');
                        }

                        const nextMeta: LibroDeTemasMetadata = {
                          ...metadata,
                          horario: scheduleToSave,
                          configuredWeekdays: finalWeekdays,
                          isScheduleLocked: true,
                        };
                        setMetadata(nextMeta);
                        setIsEditingScheduleConfig(false);
                        persistLibroData(nextMeta, entriesMap, characterOptions, true);

                        const nextSettings: AttendanceSettings = {
                          ...attendanceSettings,
                          courseWeekdays: finalWeekdays,
                          classesPerWeek: finalWeekdays.length,
                        };
                        saveCourseAttendanceSettings(courseId, nextSettings);
                        if (onUpdateAttendanceSettings) onUpdateAttendanceSettings(nextSettings);

                        try {
                          await api.updateCourse(courseId, { schedule: scheduleToSave });
                          if (onRefreshCourse) onRefreshCourse();
                        } catch (_) {}

                        setToastMsg('Días y horas de cursada guardados en el Libro de Temas.');
                        setTimeout(() => setToastMsg(null), 3500);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>Guardar</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {onOpenAttendanceSettingsModal && (
              <button
                type="button"
                onClick={onOpenAttendanceSettingsModal}
                className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer min-w-0 ${
                  isDarkMode
                    ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-750'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
                }`}
                title="Configurar fechas de inicio/fin de cuatrimestres y feriados del calendario escolar"
              >
                <Calendar className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="truncate">Calendario Escolar y Feriados</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Barra de Filtros y Buscador 100% Elástica */}
      <div
        className={`px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-end gap-2.5 min-w-0 ${
          isDarkMode ? 'bg-slate-850/60' : 'bg-neutral-50/80'
        }`}
      >

        {/* Filtros de período, estado y buscador */}
        <div className="flex items-center gap-2 flex-wrap w-full xl:w-auto flex-1 justify-end min-w-0">
          <div
            className={`flex flex-wrap p-0.5 rounded-lg border text-[11px] font-semibold w-full sm:w-auto min-w-0 ${
              isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-200'
            }`}
          >
            {[
              { id: 'all', label: 'Todo el año' },
              { id: '1c', label: '1° Cuatr.' },
              { id: '2c', label: '2° Cuatr.' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setTermFilter(tab.id as 'all' | '1c' | '2c');
                  if (tab.id === 'all' && sortOrder === 'desc') {
                    setSortOrder('asc');
                  }
                }}
                className={`flex-1 sm:flex-initial px-2.5 py-1 rounded-md transition-colors cursor-pointer text-center whitespace-nowrap ${
                  termFilter === tab.id && !(tab.id === 'all' && sortOrder === 'desc')
                    ? 'bg-blue-600 text-white'
                    : isDarkMode
                    ? 'text-slate-400 hover:text-white'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {tab.label}
              </button>
            ))}

            {/* Botón para ordenar desde la última clase dada hacia atrás */}
            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
              className={`flex-1 sm:flex-initial px-2.5 py-1 rounded-md transition-colors cursor-pointer text-center whitespace-nowrap inline-flex items-center justify-center gap-1 border-l ${
                isDarkMode ? 'border-slate-700' : 'border-neutral-200'
              } ${
                sortOrder === 'desc'
                  ? 'bg-blue-600 text-white'
                  : isDarkMode
                  ? 'text-slate-400 hover:text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
              title={
                sortOrder === 'desc'
                  ? 'Mostrando desde la última clase dada hacia atrás (clic para volver al orden cronológico)'
                  : 'Ordenar desde la última clase dada hacia atrás cronológicamente'
              }
            >
              <ArrowUpDown className="w-3 h-3 shrink-0" />
              <span>Más recientes</span>
            </button>
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className={`w-full sm:w-auto max-w-full min-w-0 flex-1 sm:flex-initial px-2.5 py-1.5 sm:py-1 rounded-lg border text-[11px] font-semibold focus:outline-hidden truncate ${
              isDarkMode
                ? 'bg-slate-800 border-slate-700 text-slate-200'
                : 'bg-white border-neutral-200 text-neutral-700'
            }`}
          >
            <option value="all">Todas las fechas ({scheduledRows.length})</option>
            <option value="completed">Con tema registrado ({stats.completedClasses})</option>
            <option value="pending">Pendientes de completar</option>
            <option value="holidays">
              Sin dictado: Feriados / Eventos ({stats.holidaysCount})
            </option>
          </select>

          <div className="relative w-full sm:w-52 flex-1 sm:flex-initial min-w-[160px]">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar tema, unidad, fecha..."
              className={`w-full min-w-0 pl-8 pr-7 py-1.5 sm:py-1 rounded-lg border text-xs focus:outline-hidden ${
                isDarkMode
                  ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500'
                  : 'bg-white border-neutral-200 text-neutral-800 placeholder:text-neutral-400'
              }`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
