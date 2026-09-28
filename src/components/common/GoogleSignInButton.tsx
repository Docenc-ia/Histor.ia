import React from 'react';

interface GoogleSignInButtonProps {
  onClick?: () => void;
  isLoading?: boolean;
  label?: string;
  className?: string;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onClick,
  isLoading = false,
  label = 'Conectar con Google Workspace',
  className = '',
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading}
      className={`inline-flex items-center justify-center gap-3 px-4 py-2.5 bg-white hover:bg-neutral-50 active:bg-neutral-100 text-[#3c4043] font-medium text-sm rounded-full border border-[#dadce0] shadow-sm transition-all hover:shadow hover:border-[#c6c8cc] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
        <path
          fill="#4285F4"
          d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.02h3.86c2.26-2.09 3.685-5.17 3.685-9.12z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3.02c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.26v3.12C3.26 21.36 7.33 24 12 24z"
        />
        <path
          fill="#FBBC05"
          d="M5.27 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.61H1.26C.46 8.23 0 10.06 0 12s.46 3.77 1.26 5.39l4.01-3.12z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.26 6.61l4.01 3.12c.95-2.85 3.6-4.98 6.73-4.98z"
        />
      </svg>
      <span>{isLoading ? 'Conectando...' : label}</span>
    </button>
  );
};
