import React from 'react';

export const Navbar: React.FC = () => {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-[64px] flex items-center justify-between px-8 bg-[#F7F7F5]/90 backdrop-blur-md border-b border-hairline transition-all">
      <div className="flex items-center">
        <div className="w-[32px] h-[32px] bg-[#1A3C2B] flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white">
            <path d="M12 22S3 18 3 10V5l9-4 9 4v5c0 8-9 12-9 12z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M7 11h2v5H7zM11 8h2v8h-2zM15 12h2v4h-2z" fill="currentColor"/>
          </svg>
        </div>
        <span className="ml-3 font-grotesk font-semibold text-[14px] tracking-wide text-[#1A3C2B]">VOICEGUARD</span>
      </div>
      <ul className="hidden md:flex gap-8 list-none m-0 p-0 text-[#3A3A38]">
        <li><a href="#detect" className="font-mono text-[10px] uppercase tracking-wider no-underline opacity-70 hover:opacity-100 transition-opacity"><span className="opacity-40 mr-1">01.</span> DETECT</a></li>
        <li><a href="#how-it-works" className="font-mono text-[10px] uppercase tracking-wider no-underline opacity-70 hover:opacity-100 transition-opacity"><span className="opacity-40 mr-1">02.</span> HOW IT WORKS</a></li>
        <li><a href="#about" className="font-mono text-[10px] uppercase tracking-wider no-underline opacity-70 hover:opacity-100 transition-opacity"><span className="opacity-40 mr-1">03.</span> SYSTEM</a></li>
      </ul>
      <div className="flex items-center gap-4">
        <div className="hidden lg:flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider opacity-60">
          <span>[ SYSTEM STATUS ]</span>
        </div>
        <a href="#detect" className="font-mono text-[10px] uppercase tracking-wider bg-[#1A3C2B] text-white px-4 py-2 hover:opacity-90 transition-opacity border-none cursor-pointer">
          ANALYZE AUDIO
        </a>
      </div>
    </nav>
  );
};
