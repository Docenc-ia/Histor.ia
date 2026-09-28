import React, { useState } from 'react';
import {
  Settings,
  CheckCircle2,
  FolderClosed,
  FileText,
  Table,
  GraduationCap,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
  Key,
  Info,
  Check,
} from 'lucide-react';
import { useWorkspaceAuth } from '../../context/WorkspaceAuthContext';
import { GoogleSignInButton } from '../common/GoogleSignInButton';

export const WorkspaceSettingsModule: React.FC = () => {
  const { user, mode, setMode, token, scopes, loginWithGoogle, logout, testConnection } = useWorkspaceAuth();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await testConnection();
      setTestResult(ok);
    } finally {
      setTesting(false);
    }
  };

  const services = [
    {
      id: 'drive',
      name: 'Google Drive API v3',
      icon: FolderClosed,
      color: 'text-amber-500',
      bg: 'bg-amber-50',
      scope: 'https://www.googleapis.com/auth/drive.file',
      description: 'Permite crear carpetas por materia, gestionar materiales didácticos y enlazar archivos con Classroom.',
      status: mode !== 'disconnected' ? 'Activo' : 'Inactivo',
    },
    {
      id: 'docs',
      name: 'Google Docs API v1',
      icon: FileText,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      scope: 'https://www.googleapis.com/auth/documents',
      description: 'Genera planificaciones de clase estructuradas directamente como documentos editables en Google Docs.',
      status: mode !== 'disconnected' ? 'Activo' : 'Inactivo',
    },
    {
      id: 'sheets',
      name: 'Google Sheets API v4',
      icon: Table,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      description: 'Exporta y sincroniza planillas de asistencia y matrices de calificaciones con fórmulas de promedio automáticas.',
      status: mode !== 'disconnected' ? 'Activo' : 'Inactivo',
    },
    {
      id: 'classroom',
      name: 'Google Classroom API v1',
      icon: GraduationCap,
      color: 'text-green-700',
      bg: 'bg-green-50',
      scope: 'https://www.googleapis.com/auth/classroom.coursework.students',
      description: 'Sincroniza cursos, publica tareas con adjuntos de Drive y recibe el cómputo de entregas en tiempo real.',
      status: mode !== 'disconnected' ? 'Activo' : 'Inactivo',
    },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
          <Settings className="w-6 h-6 text-neutral-700" />
          Configuración e Integraciones de Google Workspace
        </h2>
        <p className="text-xs text-neutral-500">
          Estado de los conectores de Google Drive, Docs, Sheets y Classroom listos para autenticación
        </p>
      </div>

      {/* Connection State Card */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-neutral-800">
                Estado de Conexión: <span className="capitalize text-blue-600 font-extrabold">{mode}</span>
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                {mode === 'connected'
                  ? 'Autenticado con Google Workspace. Tokens en memoria preparados para llamadas a la API.'
                  : mode === 'simulation'
                  ? 'Modo estructuras preparadas activo. Puedes interactuar con todos los módulos y probar exportaciones.'
                  : 'Desconectado. Inicia sesión con tu cuenta institucional para sincronizar.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {mode === 'connected' ? (
              <button
                onClick={logout}
                className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold rounded-lg transition-colors"
              >
                Desconectar Cuenta
              </button>
            ) : (
              <GoogleSignInButton onClick={loginWithGoogle} />
            )}
          </div>
        </div>

        {/* User details if logged in */}
        {user && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-neutral-50 rounded-xl text-xs">
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase font-bold">Docente Titular</span>
              <span className="font-semibold text-neutral-800">{user.name}</span>
            </div>
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase font-bold">Cuenta Institucional</span>
              <span className="font-mono text-neutral-700">{user.email}</span>
            </div>
            <div>
              <span className="text-neutral-400 block text-[10px] uppercase font-bold">Institución Educativa</span>
              <span className="font-semibold text-neutral-800">{user.school}</span>
            </div>
          </div>
        )}

        {/* Diagnostic connection check */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Info className="w-4 h-4 text-blue-500" />
            <span>Verifica la comunicación con las rutas de API del servidor full-stack.</span>
          </div>
          <button
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-semibold rounded-lg border border-neutral-200 shadow-xs transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${testing ? 'animate-spin text-blue-600' : ''}`} />
            {testing ? 'Comprobando...' : 'Test de Conexión'}
          </button>
        </div>

        {testResult !== null && (
          <div
            className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
              testResult
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {testResult ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Rutas del servidor y estructuras de Google Workspace respondiendo correctamente.</span>
              </>
            ) : (
              <span>Error al contactar el servidor.</span>
            )}
          </div>
        )}
      </div>

      {/* Services Scopes Table */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-neutral-800 uppercase tracking-wide">
          Estructuras de Servicios Google Preparadas
        </h3>
        <p className="text-xs text-neutral-500 leading-relaxed">
          Cada servicio cuenta con sus interfaces tipadas, funciones de sincronización y adaptadores de datos listos para operar cuando se active el flujo OAuth.
        </p>

        <div className="space-y-3 pt-2">
          {services.map((svc) => {
            const Icon = svc.icon;
            return (
              <div
                key={svc.id}
                className="p-4 rounded-xl border border-neutral-200 hover:border-neutral-300 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-xl ${svc.bg} ${svc.color} shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold text-neutral-800">{svc.name}</h4>
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.2 rounded-full">
                        {svc.status}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 mt-0.5">{svc.description}</p>
                    <div className="mt-2 flex items-center gap-1.5 text-[11px] font-mono text-neutral-500">
                      <Key className="w-3 h-3 text-neutral-400" />
                      <span>Scope: {svc.scope}</span>
                    </div>
                  </div>
                </div>

                <div className="shrink-0 flex md:flex-col items-end justify-between">
                  <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded-md">
                    Estructura Lista
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Next Steps / Roadmap */}
      <div className="p-5 rounded-2xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-600 space-y-2">
        <h4 className="font-bold text-neutral-800 flex items-center gap-1.5">
          <Info className="w-4 h-4 text-blue-600" />
          Hoja de Ruta y Expansión Modular
        </h4>
        <p className="leading-relaxed">
          Esta aplicación fue concebida con arquitectura modular para docentes. Puedes continuar pidiendo nuevas funciones para expandir los módulos existentes:
        </p>
        <ul className="list-disc list-inside space-y-1 text-neutral-500 pt-1">
          <li><strong>Módulo Classroom:</strong> Importación automática de entregas y retroalimentaciones directas.</li>
          <li><strong>Módulo Sheets:</strong> Ponderaciones porcentuales avanzadas para evaluaciones bimestrales.</li>
          <li><strong>Módulo Docs:</strong> Nuevas plantillas de diseño curricular adaptadas a marcos educativos.</li>
          <li><strong>Módulo Drive:</strong> Visor integrado de PDFs y material audiovisual.</li>
        </ul>
      </div>
    </div>
  );
};
