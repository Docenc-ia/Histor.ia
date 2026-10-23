import React from 'react';
import {
  Bookmark,
  Sparkles,
  Save,
  Settings,
  Search,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  AbsencePresetTemplate,
  AbsenceNotificationSettings,
} from '../../../types';

export interface NewConfigPresetState {
  name: string;
  text: string;
  channel: 'classroom' | 'gmail' | 'any';
  category: 'Ausencia' | 'Disposición';
  isOpen: boolean;
}

export interface NotificationPresetsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  notifConfigActiveTab: 'reasons' | 'presets' | 'settings';
  setNotifConfigActiveTab: (tab: 'reasons' | 'presets' | 'settings') => void;
  conductReasonTemplates: Record<string, string>;
  savedPresets: AbsencePresetTemplate[];
  searchReasonQuery: string;
  setSearchReasonQuery: (val: string) => void;
  isNewReasonFormOpen: boolean;
  setIsNewReasonFormOpen: (open: boolean) => void;
  newReasonName: string;
  setNewReasonName: (val: string) => void;
  newReasonTemplateText: string;
  setNewReasonTemplateText: React.Dispatch<React.SetStateAction<string>>;
  getTemplateForReason: (reason: string, mode?: 'positive' | 'negative') => string;
  handleSaveTemplateForReason: (reason: string, tpl: string) => void;
  allKnownReasonKeys: string[];
  isReasonCustomized: (reason: string) => boolean;
  reasonCardDrafts: Record<string, string>;
  setReasonCardDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  handleResetTemplateForReason: (reason: string) => void;
  newConfigPreset: NewConfigPresetState;
  setNewConfigPreset: React.Dispatch<React.SetStateAction<NewConfigPresetState>>;
  handleSavePreset: (
    name: string,
    text: string,
    channel: 'classroom' | 'gmail' | 'any',
    category: 'Ausencia' | 'Disposición'
  ) => string;
  handleDeletePreset: (id: string) => void;
  notifSettings: AbsenceNotificationSettings;
  setNotifSettings: React.Dispatch<React.SetStateAction<AbsenceNotificationSettings>>;
  handleSaveNotifSettings: (settings: AbsenceNotificationSettings) => void;
}

export const NotificationPresetsConfigModal: React.FC<NotificationPresetsConfigModalProps> = ({
  isOpen,
  onClose,
  isDarkMode,
  notifConfigActiveTab,
  setNotifConfigActiveTab,
  conductReasonTemplates,
  savedPresets,
  searchReasonQuery,
  setSearchReasonQuery,
  isNewReasonFormOpen,
  setIsNewReasonFormOpen,
  newReasonName,
  setNewReasonName,
  newReasonTemplateText,
  setNewReasonTemplateText,
  getTemplateForReason,
  handleSaveTemplateForReason,
  allKnownReasonKeys,
  isReasonCustomized,
  reasonCardDrafts,
  setReasonCardDrafts,
  handleResetTemplateForReason,
  newConfigPreset,
  setNewConfigPreset,
  handleSavePreset,
  handleDeletePreset,
  notifSettings,
  setNotifSettings,
  handleSaveNotifSettings,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-neutral-200 text-neutral-900'
        }`}
      >
        {/* Header */}
        <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">
                Configuración de Avisos por Ausencia / Disposición
              </h3>
              <p className="text-[11px] text-neutral-500 dark:text-slate-400">
                Personaliza los mensajes preconfigurados que se cargan automáticamente
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className={`px-4 pt-2 border-b flex gap-1 overflow-x-auto ${isDarkMode ? 'border-slate-800 bg-slate-850/50' : 'border-neutral-200 bg-neutral-50/50'}`}>
          <button
            type="button"
            onClick={() => setNotifConfigActiveTab('reasons')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              notifConfigActiveTab === 'reasons'
                ? 'border-purple-600 text-purple-600 dark:text-purple-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Mensajes por Cuestión / Motivo</span>
            {Object.keys(conductReasonTemplates).length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                {Object.keys(conductReasonTemplates).length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setNotifConfigActiveTab('presets')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              notifConfigActiveTab === 'presets'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Plantillas Generales e Inasistencias</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-neutral-100 text-neutral-600 dark:bg-slate-800 dark:text-slate-300">
              {savedPresets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setNotifConfigActiveTab('settings')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl border-b-2 transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              notifConfigActiveTab === 'settings'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Modo Rápido y Canales</span>
          </button>
        </div>

        {/* Body */}
        {notifConfigActiveTab === 'reasons' && (
          <div className="p-5 overflow-y-auto space-y-4 text-xs">
            {/* Banner explicativo */}
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                isDarkMode ? 'bg-purple-950/20 border-purple-900/60 text-purple-200' : 'bg-purple-50/80 border-purple-200 text-purple-900'
              }`}
            >
              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-xs leading-tight">
                  Mensajes predeterminados específicos para cada cuestión de conducta
                </p>
                <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-purple-300/80">
                  Configura un mensaje propio para cada situación (por ejemplo: <strong>"Sin libro"</strong>, <strong>"Falta de tarea"</strong>, etc.). La próxima vez que un alumno tenga esa falta y le descuentes un punto de disposición, <strong>se cargará automáticamente ese mensaje específico</strong>.
                </p>
              </div>
            </div>

            {/* Buscador y botón para agregar nueva cuestión con mensaje */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={searchReasonQuery}
                  onChange={(e) => setSearchReasonQuery(e.target.value)}
                  placeholder="Buscar cuestión (ej: Sin libro, tarea, celular...)"
                  className={`w-full pl-8 pr-8 py-1.5 text-xs rounded-xl border focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                    isDarkMode ? 'bg-slate-800 border-slate-700 text-white placeholder:text-slate-500' : 'bg-white border-neutral-300 text-neutral-900'
                  }`}
                />
                {searchReasonQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchReasonQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsNewReasonFormOpen(!isNewReasonFormOpen)}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-700 text-white shadow-xs cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isNewReasonFormOpen ? 'Cancelar' : 'Nueva Cuestión'}</span>
              </button>
            </div>

            {/* Formulario desplegable para agregar nueva cuestión con mensaje propio */}
            {isNewReasonFormOpen && (
              <div
                className={`p-3.5 rounded-xl border space-y-3 animate-in fade-in duration-150 ${
                  isDarkMode ? 'bg-slate-800/90 border-slate-700' : 'bg-purple-50/60 border-purple-200'
                }`}
              >
                <span className="font-bold text-xs flex items-center gap-1.5 text-purple-900 dark:text-purple-300">
                  <Sparkles className="w-3.5 h-3.5" />
                  Crear nueva cuestión y definir su mensaje predeterminado
                </span>

                <div>
                  <label className="block text-[11px] font-semibold mb-1 text-neutral-700 dark:text-slate-300">
                    Nombre de la cuestión (ej: "Sin libro", "Sin guardapolvo", "Falta TP práctico")
                  </label>
                  <input
                    type="text"
                    value={newReasonName}
                    onChange={(e) => setNewReasonName(e.target.value)}
                    placeholder="Ej: Sin libro"
                    className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                      isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-neutral-700 dark:text-slate-300">
                      Mensaje que aparecerá por defecto
                    </label>
                    <span className="text-[10px] text-neutral-400">Variables automáticas disponibles</span>
                  </div>
                  <textarea
                    rows={3}
                    value={newReasonTemplateText}
                    onChange={(e) => setNewReasonTemplateText(e.target.value)}
                    placeholder="Estimado/a {ESTUDIANTE}, hoy {FECHA} se registró un llamado de atención en {MATERIA} por no traer... (-1 punto de disposición, actual: {DISPOSICION}/10)."
                    className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                      isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                    }`}
                  />

                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                    {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}'].map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setNewReasonTemplateText((prev) => `${prev} ${tag}`)}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsNewReasonFormOpen(false);
                      setNewReasonName('');
                      setNewReasonTemplateText('');
                    }}
                    className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-slate-300 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={!newReasonName.trim()}
                    onClick={() => {
                      const name = newReasonName.trim();
                      const tpl = newReasonTemplateText.trim() || getTemplateForReason(name);
                      handleSaveTemplateForReason(name, tpl);
                      setIsNewReasonFormOpen(false);
                      setNewReasonName('');
                      setNewReasonTemplateText('');
                    }}
                    className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Guardar Cuestión y Mensaje</span>
                  </button>
                </div>
              </div>
            )}

            {/* Lista de todas las cuestiones conocidas */}
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {allKnownReasonKeys
                .filter((r) => !searchReasonQuery.trim() || r.toLowerCase().includes(searchReasonQuery.toLowerCase().trim()))
                .map((reasonKey) => {
                  const customized = isReasonCustomized(reasonKey);
                  const currentDraft = reasonCardDrafts[reasonKey] ?? getTemplateForReason(reasonKey);
                  const hasChanges =
                    reasonCardDrafts[reasonKey] !== undefined && reasonCardDrafts[reasonKey] !== getTemplateForReason(reasonKey);

                  return (
                    <div
                      key={reasonKey}
                      className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                        customized
                          ? isDarkMode
                            ? 'bg-purple-950/20 border-purple-800/70'
                            : 'bg-purple-50/40 border-purple-200'
                          : isDarkMode
                          ? 'bg-slate-800/40 border-slate-700/80'
                          : 'bg-neutral-50/70 border-neutral-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-neutral-900 dark:text-white">
                            {reasonKey}
                          </span>
                          {customized ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              <Sparkles className="w-2.5 h-2.5" />
                              Mensaje propio guardado
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-200 text-neutral-600 dark:bg-slate-700 dark:text-slate-300">
                              Plantilla estándar
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {customized && (
                            <button
                              type="button"
                              onClick={() => {
                                handleResetTemplateForReason(reasonKey);
                                setReasonCardDrafts((prev) => {
                                  const n = { ...prev };
                                  delete n[reasonKey];
                                  return n;
                                });
                              }}
                              className="text-[11px] text-rose-500 hover:underline cursor-pointer"
                              title="Volver a la plantilla predeterminada del sistema"
                            >
                              Restablecer a estándar
                            </button>
                          )}
                        </div>
                      </div>

                      <textarea
                        rows={3}
                        value={currentDraft}
                        onChange={(e) => {
                          const val = e.target.value;
                          setReasonCardDrafts((prev) => ({ ...prev, [reasonKey]: val }));
                        }}
                        placeholder="Escribe el mensaje por defecto para esta cuestión..."
                        className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-purple-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                          {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}'].map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => {
                                setReasonCardDrafts((prev) => ({
                                  ...prev,
                                  [reasonKey]: `${currentDraft} ${tag}`,
                                }));
                              }}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                            >
                              {tag}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            handleSaveTemplateForReason(reasonKey, currentDraft);
                            setReasonCardDrafts((prev) => {
                              const n = { ...prev };
                              delete n[reasonKey];
                              return n;
                            });
                          }}
                          className={`px-3 py-1 text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1 transition-all ${
                            hasChanges
                              ? 'bg-purple-600 hover:bg-purple-700 text-white animate-pulse'
                              : 'bg-purple-600 hover:bg-purple-700 text-white'
                          }`}
                        >
                          <Save className="w-3 h-3" />
                          <span>Guardar para "{reasonKey}"</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {notifConfigActiveTab === 'presets' && (
          <div className="p-5 overflow-y-auto space-y-4 text-xs">
            {/* SECCIÓN: PLANTILLAS Y MENSAJES PREESTABLECIDOS */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h4 className="font-bold text-xs text-neutral-900 dark:text-white">
                    Plantillas Generales y de Inasistencias ({savedPresets.length})
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setNewConfigPreset((p) => ({ ...p, isOpen: !p.isOpen }))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{newConfigPreset.isOpen ? 'Cancelar' : 'Nueva plantilla'}</span>
                </button>
              </div>

              {/* Form to create a new preset */}
              {newConfigPreset.isOpen && (
                <div
                  className={`p-3.5 rounded-xl border space-y-3 animate-in fade-in duration-150 ${
                    isDarkMode ? 'bg-slate-800/80 border-slate-700' : 'bg-blue-50/50 border-blue-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-blue-900 dark:text-blue-200">
                      Crear Nuevo Mensaje Preestablecido
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                        Nombre de la plantilla
                      </label>
                      <input
                        type="text"
                        value={newConfigPreset.name}
                        onChange={(e) => setNewConfigPreset((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Ej: Falta con recuperatorio, TP..."
                        className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                        Tipo de Aviso
                      </label>
                      <select
                        value={newConfigPreset.category}
                        onChange={(e) => setNewConfigPreset((p) => ({ ...p, category: e.target.value as any }))}
                        className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      >
                        <option value="Ausencia">Inasistencia</option>
                        <option value="Disposición">Conducta / Disposición</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold mb-1 text-neutral-600 dark:text-slate-300">
                        Canal recomendado
                      </label>
                      <select
                        value={newConfigPreset.channel}
                        onChange={(e) => setNewConfigPreset((p) => ({ ...p, channel: e.target.value as any }))}
                        className={`w-full px-3 py-1.5 text-xs rounded-lg border focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                          isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                        }`}
                      >
                        <option value="classroom">Tablón de Classroom</option>
                        <option value="gmail">Correo Gmail</option>
                        <option value="any">Cualquier canal</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-[11px] font-semibold text-neutral-600 dark:text-slate-300">
                        Texto del mensaje
                      </label>
                      <span className="text-[10px] text-neutral-400">Usa las variables dinámicas</span>
                    </div>
                    <textarea
                      rows={3}
                      value={newConfigPreset.text}
                      onChange={(e) => setNewConfigPreset((p) => ({ ...p, text: e.target.value }))}
                      placeholder="Estimado/a {ESTUDIANTE}, se ha registrado una inasistencia u observación en {MATERIA}..."
                      className={`w-full p-2.5 text-xs rounded-lg border font-mono focus:outline-hidden focus:ring-1 focus:ring-blue-500 ${
                        isDarkMode ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white border-neutral-300 text-neutral-900'
                      }`}
                    />

                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      <span className="text-[10px] text-neutral-400 mr-1">Insertar:</span>
                      {['{ESTUDIANTE}', '{MATERIA}', '{DISPOSICION}', '{FECHA}', '{MOTIVO}'].map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setNewConfigPreset((p) => ({ ...p, text: `${p.text} ${tag}` }))}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-200 dark:bg-slate-700 hover:opacity-80 cursor-pointer font-mono"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setNewConfigPreset((p) => ({ ...p, isOpen: false, name: '', text: '', category: 'Ausencia' }))}
                      className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-700 dark:hover:text-slate-300 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={!newConfigPreset.name.trim() || !newConfigPreset.text.trim()}
                      onClick={() => {
                        handleSavePreset(newConfigPreset.name, newConfigPreset.text, newConfigPreset.channel, newConfigPreset.category);
                        setNewConfigPreset({ name: '', text: '', channel: 'classroom', category: 'Ausencia', isOpen: false });
                      }}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs cursor-pointer inline-flex items-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Guardar Plantilla</span>
                    </button>
                  </div>
                </div>
              )}

              {/* List of presets */}
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {savedPresets.map((preset) => (
                  <div
                    key={preset.id}
                    className={`p-3 rounded-xl border flex flex-col gap-1.5 transition-colors ${
                      isDarkMode ? 'bg-slate-800/40 border-slate-800' : 'bg-neutral-50/70 border-neutral-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs text-neutral-900 dark:text-white">
                          {preset.name}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            preset.category === 'Disposición'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                              : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-200 dark:border-red-800'
                          }`}
                        >
                          {preset.category === 'Disposición' ? 'Conducta' : 'Ausencia'}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            preset.channel === 'classroom'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                              : preset.channel === 'gmail'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-neutral-200 text-neutral-700 dark:bg-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {preset.channel === 'classroom' ? 'Classroom' : preset.channel === 'gmail' ? 'Gmail' : 'Ambos canales'}
                        </span>
                      </div>
                      {savedPresets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleDeletePreset(preset.id)}
                          className="p-1 text-neutral-400 hover:text-red-500 rounded transition-colors cursor-pointer"
                          title="Eliminar esta plantilla"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-neutral-600 dark:text-slate-400 font-mono line-clamp-2">
                      {preset.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {notifConfigActiveTab === 'settings' && (
          <div className="p-5 overflow-y-auto space-y-4 text-xs">
            {/* MODO RÁPIDO DE ASISTENCIA */}
            <div
              className={`p-3.5 rounded-xl border transition-all ${
                notifSettings.dontShowPopupOnAbsence
                  ? 'border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/40 dark:border-indigo-800'
                  : isDarkMode
                  ? 'bg-slate-800/40 border-slate-700'
                  : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!notifSettings.dontShowPopupOnAbsence}
                  onChange={(e) => setNotifSettings((prev) => ({ ...prev, dontShowPopupOnAbsence: e.target.checked }))}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 mt-0.5"
                />
                <div>
                  <span className="font-bold text-xs block text-neutral-900 dark:text-white">
                    Modo rápido de asistencia: No abrir ventana emergente en cada falta tomada
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400 leading-relaxed block mt-0.5">
                    Al activar este modo, podrás tomar la asistencia de forma rápida haciendo clic en <strong>"+ Falta"</strong> sin interrupciones. Las inasistencias quedarán registradas como pendientes y luego podrás seleccionar a los ausentes para <strong>enviar todos los mensajes juntos en lote</strong> al finalizar la clase.
                  </span>
                </div>
              </label>
            </div>

            {/* MODO RÁPIDO DE CONDUCTA / DISPOSICIÓN */}
            <div
              className={`p-3.5 rounded-xl border transition-all ${
                notifSettings.dontShowPopupOnDisposition
                  ? 'border-purple-400 bg-purple-50/60 dark:bg-purple-950/40 dark:border-purple-800'
                  : isDarkMode
                  ? 'bg-slate-800/40 border-slate-700'
                  : 'bg-neutral-50 border-neutral-200'
              }`}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!notifSettings.dontShowPopupOnDisposition}
                  onChange={(e) => setNotifSettings((prev) => ({ ...prev, dontShowPopupOnDisposition: e.target.checked }))}
                  className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 mt-0.5"
                />
                <div>
                  <span className="font-bold text-xs block text-neutral-900 dark:text-white">
                    Modo rápido de conducta: No abrir ventana emergente al restar puntos de disposición
                  </span>
                  <span className="text-[11px] text-neutral-500 dark:text-slate-400 leading-relaxed block mt-0.5">
                    Al activar este modo, podrás registrar conductas y restar puntos de disposición de forma ágil. Las observaciones quedarán asentadas en el historial y podrás enviar los avisos a los alumnos cuando lo prefieras.
                  </span>
                </div>
              </label>
            </div>

            {/* Canal predeterminado */}
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-neutral-700 dark:text-slate-300">
                Canal de envío predeterminado
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-colors ${
                    notifSettings.channel === 'classroom'
                      ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200'
                      : isDarkMode
                      ? 'border-slate-700 bg-slate-800/60 text-slate-300'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="notif_channel"
                    value="classroom"
                    checked={notifSettings.channel === 'classroom'}
                    onChange={() => setNotifSettings((prev) => ({ ...prev, channel: 'classroom' }))}
                    className="text-blue-600"
                  />
                  <div>
                    <span className="font-bold block">Tablón de Classroom</span>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400">Aviso individual en el curso (sin emails)</span>
                  </div>
                </label>

                <label
                  className={`p-3 rounded-xl border flex items-center gap-2.5 cursor-pointer transition-colors ${
                    notifSettings.channel === 'gmail'
                      ? 'border-blue-600 bg-blue-50/70 text-blue-900 dark:bg-blue-950/40 dark:border-blue-500 dark:text-blue-200'
                      : isDarkMode
                      ? 'border-slate-700 bg-slate-800/60 text-slate-300'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="notif_channel"
                    value="gmail"
                    checked={notifSettings.channel === 'gmail'}
                    onChange={() => setNotifSettings((prev) => ({ ...prev, channel: 'gmail' }))}
                    className="text-blue-600"
                  />
                  <div>
                    <span className="font-bold block">Correo Electrónico (Gmail)</span>
                    <span className="text-[10px] text-neutral-500 dark:text-slate-400">Envío por correo al estudiante</span>
                  </div>
                </label>
              </div>
            </div>

            {/* Plantilla Classroom */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Mensaje por defecto para Classroom (Tablón individual)
                </label>
                <span className="text-[10px] text-neutral-400">Variables: {'{ESTUDIANTE}'}, {'{MATERIA}'}, {'{DISPOSICION}'}, {'{FECHA}'}</span>
              </div>
              <textarea
                rows={3}
                value={notifSettings.templateClassroom}
                onChange={(e) => setNotifSettings((prev) => ({ ...prev, templateClassroom: e.target.value }))}
                className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>

            {/* Plantilla Gmail */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-neutral-700 dark:text-slate-300">
                  Mensaje por defecto para Correo (Gmail)
                </label>
                <span className="text-[10px] text-neutral-400">Variables: {'{ESTUDIANTE}'}, {'{MATERIA}'}, {'{DISPOSICION}'}, {'{FECHA}'}</span>
              </div>
              <textarea
                rows={3}
                value={notifSettings.templateGmail}
                onChange={(e) => setNotifSettings((prev) => ({ ...prev, templateGmail: e.target.value }))}
                className={`w-full p-3 text-xs rounded-xl border focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 ${
                  isDarkMode
                    ? 'bg-slate-800 border-slate-700 text-white'
                    : 'bg-white border-neutral-300 text-neutral-900'
                }`}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className={`p-4 border-t flex justify-end gap-2 ${isDarkMode ? 'border-slate-800 bg-slate-850' : 'border-neutral-200 bg-neutral-50'}`}>
          <button
            type="button"
            onClick={onClose}
            className={`px-3.5 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
              isDarkMode ? 'border-slate-700 text-slate-300 hover:bg-slate-800' : 'border-neutral-200 text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => {
              handleSaveNotifSettings(notifSettings);
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
          >
            Guardar Configuración
          </button>
        </div>
      </div>
    </div>
  );
};
