import React from 'react';

interface SmecLogoProps {
  className?: string;
}

const SmecLogo: React.FC<SmecLogoProps> = ({ className = "h-10" }) => {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* House icon with person */}
      <svg viewBox="0 0 60 60" className="h-full w-auto" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* House outline */}
        <path
          d="M8 55V28L30 8L52 28V55H8Z"
          stroke="url(#gradient)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Roof peak circle */}
        <circle cx="42" cy="16" r="6" stroke="url(#gradient)" strokeWidth="4" fill="none" />
        {/* Person head */}
        <circle cx="30" cy="32" r="6" stroke="url(#gradient)" strokeWidth="4" fill="none" />
        {/* Person body */}
        <path
          d="M30 40V52"
          stroke="url(#gradient)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#A855F7" />
          </linearGradient>
        </defs>
      </svg>

      {/* SMEC AI text */}
      <span className="text-2xl font-semibold tracking-widest text-gray-800">
        SMEC AI
      </span>
    </div>
  );
};

export default SmecLogo;
