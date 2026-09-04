import React from 'react';

export const Footer: React.FC = () => {
  return (
    <footer className="py-10 px-8 md:px-[64px] flex flex-col md:flex-row items-center justify-between gap-8 text-center md:text-left">
      <div className="flex items-center gap-3 justify-center">
        <div className="w-6 h-6 bg-[#1A3C2B] flex shrink-0 items-center justify-center">
          <div className="w-2 h-2 bg-white/50"></div>
        </div>
        <div>
          <div className="font-grotesk text-[14px] font-bold text-[#1A3C2B]">VOICE CLONING ATTACK DETECTION</div>
          <div className="font-mono text-[9px] uppercase tracking-widest opacity-40">AI-powered voice impersonation analysis.</div>
        </div>
      </div>

      <div className="flex gap-8 font-mono text-[10px] uppercase tracking-widest opacity-50 justify-center">
         <div>
           <div className="opacity-50">MODEL</div>
           <div>PELLAV2</div>
         </div>
         <div>
           <div className="opacity-50">INPUT</div>
           <div>MP3 / WAV</div>
         </div>
         <div>
           <div className="opacity-50">STATUS</div>
           <div>SYSTEM READY</div>
         </div>
      </div>

      <div className="flex items-center font-mono text-[10px] uppercase tracking-widest justify-center">
         <a href="https://github.com/jaggu-max/voice-cloning-attack-detection" target="_blank" rel="noreferrer" className="text-[#1A3C2B] opacity-60 hover:opacity-100 no-underline transition-opacity">
           GitHub: jaggu-max/voice-cloning-attack-detection
         </a>
      </div>
    </footer>
  );
};
