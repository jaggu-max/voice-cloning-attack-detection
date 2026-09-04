import React from 'react';

export const NetworkTopology: React.FC = () => {
  return (
    <section className="py-20 lg:py-32 px-8 md:px-[64px] border-b border-hairline grid grid-cols-1 lg:grid-cols-[1fr_480px] gap-16 lg:gap-32 items-center">
      <div>
        <span className="font-mono text-[10px] uppercase tracking-widest opacity-50 mb-4 block">05 / NETWORK</span>
        <h2 className="font-grotesk text-[36px] md:text-[48px] font-bold text-[#1A3C2B] leading-[1.1] mb-6">
          System<br/>Architecture<br/>Graph
        </h2>
        <div className="flex items-start gap-4 mb-8">
          <div className="w-[1px] bg-[#1A3C2B] opacity-30 min-h-[60px]"></div>
          <p className="font-mono text-[12px] opacity-60 leading-relaxed uppercase tracking-wider">
            An abstract visualization of how audio input, preprocessing, detection model, and risk assessment interconnect.
          </p>
        </div>
      </div>
      
      <div className="flex justify-center overflow-hidden">
        <div className="w-full max-w-[420px] aspect-square rounded-full border border-hairline-strong relative flex items-center justify-center">
          <div className="absolute w-[16px] h-[16px] bg-[#1A3C2B] z-10 flex items-center justify-center">
             <div className="w-[4px] h-[4px] bg-white opacity-50"></div>
          </div>
          
          <div className="absolute w-[40%] h-[40%] rounded-full border border-dashed border-[#1A3C2B]/30 animate-[spin_30s_linear_infinite]">
             <div className="absolute top-0 left-1/2 -ml-[5px] -mt-[5px] w-[10px] h-[10px] bg-[#FF8C69]"></div>
          </div>
          
          <div className="absolute w-[66%] h-[66%] rounded-full border border-dashed border-[#1A3C2B]/15 animate-[spin_20s_linear_infinite_reverse]">
             <div className="absolute bottom-[10%] right-[10%] w-[10px] h-[10px] bg-[#9EFFBF]"></div>
          </div>
          
          <div className="absolute w-[90%] h-[90%] rounded-full border border-dashed border-[#1A3C2B]/10 animate-[spin_40s_linear_infinite]">
             <div className="absolute bottom-[10%] left-[10%] w-[10px] h-[10px] bg-[#F4D35E]"></div>
          </div>
        </div>
      </div>
    </section>
  );
};
