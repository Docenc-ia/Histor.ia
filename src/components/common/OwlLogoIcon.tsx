import React, { useState } from 'react';

interface OwlLogoIconProps {
  className?: string;
  size?: number;
  usePhoto?: boolean;
  useVideo?: boolean;
  loop?: boolean;
}

/**
 * OwlLogoIcon: Renders the official animated video logo of Docenc.IA,
 * or falls back to the original high-fidelity vector SVG owl logo.
 * The video reproduces once upon loading (no loop) and replays on click.
 */
export const OwlLogoIcon: React.FC<OwlLogoIconProps> = ({
  className = 'w-10 h-10',
  size = 40,
  usePhoto = false,
  useVideo = true,
  loop = false,
}) => {
  const [videoError, setVideoError] = useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  const handleReplay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  };

  // If video is enabled and available, render the animated video logo
  if (useVideo && !videoError) {
    return (
      <div
        onClick={handleReplay}
        className={`relative rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center border border-cyan-500/40 shadow-md shadow-cyan-950/50 group cursor-pointer transition-all duration-300 hover:border-cyan-400 hover:shadow-cyan-500/30 ${className}`}
        style={{ width: size, height: size }}
        title="Docenc.IA (Clic para reproducir animación)"
      >
        <video
          ref={videoRef}
          autoPlay
          loop={loop}
          muted
          playsInline
          onError={() => setVideoError(true)}
          className="w-full h-full object-cover object-center transform transition-transform duration-300 group-hover:scale-105 pointer-events-none"
        >
          <source src="/logo-animado.mp4" type="video/mp4" />
          <source src="/logo-animado-original.mp4" type="video/mp4" />
          <source src="/logo-animado.webm" type="video/webm" />
          <source src="/logo.mp4" type="video/mp4" />
        </video>
      </div>
    );
  }

  // Fallback original high-fidelity vector SVG owl logo
  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-gradient-to-br from-slate-950 via-[#0a1128] to-blue-950 flex items-center justify-center border border-cyan-400/40 shadow-md shadow-blue-950/60 group cursor-pointer transition-all duration-300 hover:border-cyan-400 hover:shadow-cyan-500/30 ${className}`}
      style={{ width: size, height: size }}
      title="Docenc.IA"
    >
      <div className="absolute inset-0 bg-radial from-cyan-500/20 via-transparent to-transparent opacity-80" />

      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full p-0.5 relative z-10"
      >
        <defs>
          <radialGradient id="owlEyeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#a5f3fc" stopOpacity="1" />
            <stop offset="35%" stopColor="#22d3ee" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#0284c7" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#082f49" stopOpacity="0" />
          </radialGradient>

          <filter id="eyeGlowFilter" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Ear Tufts (Realistic brown/cream feather pattern) */}
        <path d="M24 36 C 18 20, 22 8, 33 5 C 34 16, 36 26, 40 33 Z" fill="#292524" stroke="#78716c" strokeWidth="1" />
        <path d="M76 36 C 82 20, 78 8, 67 5 C 66 16, 64 26, 60 33 Z" fill="#292524" stroke="#78716c" strokeWidth="1" />

        {/* Head Contour */}
        <path
          d="M26 39 C 19 54, 21 72, 34 85 C 44 93, 56 93, 66 85 C 79 72, 81 54, 74 39 C 70 29, 62 25, 50 25 C 38 25, 30 29, 26 39 Z"
          fill="#1c1917"
          stroke="#44403c"
          strokeWidth="1.5"
        />

        {/* Facial Disc Contour with natural speckles */}
        <path
          d="M32 44 C 28 58, 33 74, 50 78 C 67 74, 72 58, 68 44 C 64 36, 55 36, 50 42 C 45 36, 36 36, 32 44 Z"
          fill="#0c0a09"
          stroke="#78716c"
          strokeWidth="1"
        />

        {/* White facial feathers around beak */}
        <path d="M42 48 Q 50 42, 58 48 L 54 62 L 46 62 Z" fill="#e7e5e4" opacity="0.9" />

        {/* GLOWING CYAN EYES */}
        <circle cx="36" cy="53" r="16" fill="url(#owlEyeGlow)" filter="url(#eyeGlowFilter)" />
        <circle cx="64" cy="53" r="16" fill="url(#owlEyeGlow)" filter="url(#eyeGlowFilter)" />

        <circle cx="36" cy="53" r="11" fill="#083344" stroke="#38bdf8" strokeWidth="1.5" />
        <circle cx="64" cy="53" r="11" fill="#083344" stroke="#38bdf8" strokeWidth="1.5" />

        <circle cx="36" cy="53" r="8.5" fill="#22d3ee" />
        <circle cx="64" cy="53" r="8.5" fill="#22d3ee" />

        <circle cx="36" cy="53" r="4.5" fill="#ffffff" />
        <circle cx="64" cy="53" r="4.5" fill="#ffffff" />

        {/* Beak */}
        <polygon points="50,52 46,64 50,71 54,64" fill="#0f172a" stroke="#334155" strokeWidth="1" />
        <line x1="50" y1="54" x2="50" y2="67" stroke="#38bdf8" strokeWidth="1" strokeLinecap="round" />
      </svg>
    </div>
  );
};
