import React from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

interface PrivacyPolicyViewProps {
  onBack: () => void;
}

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-[#F9F8F6] text-neutral-900 py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto bg-white border border-neutral-200 rounded-2xl shadow-sm p-6 sm:p-10 space-y-6">
        <div className="flex items-center justify-between gap-4 border-b border-neutral-100 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                Política de Privacidad
              </h1>
              <p className="text-xs text-slate-500">
                Docenc.ia Gestor de Clase • Última actualización: 2026
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Volver</span>
          </button>
        </div>

        <p className="text-sm text-slate-700 leading-relaxed">
          <strong>Docenc.ia Gestor de Clase</strong> es una plataforma educativa diseñada para que los docentes organicen su asistencia, disposición en el aula, calificaciones e informes académicos en sincronía con su cuenta de Google Workspace.
        </p>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">1. Información a la que accedemos</h2>
          <p className="text-sm text-slate-700 leading-relaxed">
            Al iniciar sesión con Google y autorizar los permisos correspondientes, la aplicación accede exclusivamente a los datos requeridos para ejecutar las acciones iniciadas por el docente:
          </p>
          <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1.5">
            <li><strong>Identidad básica (nombre y correo):</strong> para autenticar al docente y mantener sus cursos y registros aislados.</li>
            <li><strong>Google Classroom:</strong> lectura de materias, nóminas de estudiantes y publicación de avisos o tareas cuando el docente lo solicita.</li>
            <li><strong>Google Drive y Google Sheets:</strong> creación y respaldo de carpetas del curso y planillas de asistencia, disposición y notas en el Drive del docente.</li>
            <li><strong>Google Forms:</strong> importación de calificaciones finales de evaluaciones seleccionadas por el docente.</li>
            <li><strong>Google Calendar y Gmail:</strong> consulta de horarios escolares y envío de notificaciones educativas solicitadas por el docente.</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">2. Uso limitado y confidencialidad</h2>
          <p className="text-sm text-slate-700 leading-relaxed">
            No vendemos, alquilamos ni compartimos datos personales de docentes o estudiantes con terceros, ni los utilizamos con fines publicitarios. El uso de la información recibida mediante las APIs de Google cumple con la Política de Datos de Usuario de los Servicios de API de Google (<em>Google API Services User Data Policy</em>), incluyendo los requisitos de Uso Limitado.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-900">3. Control del usuario y revocación</h2>
          <p className="text-sm text-slate-700 leading-relaxed">
            Podés revocar el acceso otorgado en cualquier momento desde{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              myaccount.google.com/permissions
            </a>
            . Para consultas o eliminación de datos, escribí a{' '}
            <a href="mailto:canomorenojj@gmail.com" className="text-blue-600 underline">
              canomorenojj@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
};
