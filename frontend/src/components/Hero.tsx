import React from 'react';

export const Hero: React.FC = () => {
  return (
    <section className="min-h-screen pt-[120px] pb-[80px] px-8 md:px-[64px] grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-[60px] items-center border-b border-hairline">
      <div>
        <div className="flex items-center gap-4 mb-9">
          <span className="inline-flex items-center gap-2 border border-hairline-strong px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-[#1A3C2B]">
            01 / VOICE SECURITY
          </span>
        </div>
        <h1 className="font-grotesk text-[64px] lg:text-[96px] font-bold leading-[0.9] tracking-tight text-[#1A3C2B] mb-9">
          Detect<br/>
          <span className="text-[#FF8C69]">AI-generated</span><br/>
          voices.
        </h1>
        <div className="flex items-start gap-0">
          <div className="w-[1px] bg-[#1A3C2B] opacity-35 mr-5 shrink-0 self-stretch"></div>
          <div>
            <p className="font-sans text-[15px] leading-relaxed max-w-[480px] mb-6">
              Analyze suspicious voice recordings and identify signals associated with synthetic speech.
            </p>
            <div className="grid grid-cols-3 gap-8 font-mono text-[10px] uppercase tracking-[0.1em] opacity-80 pt-4 border-t border-hairline">
              <div>
                <div className="opacity-50 mb-1">MODEL</div>
                <div>PELLAV2</div>
              </div>
              <div>
                <div className="opacity-50 mb-1">INPUT</div>
                <div>MP3 / WAV</div>
              </div>
              <div>
                <div className="opacity-50 mb-1">OUTPUT</div>
                <div>AI-GENERATED PROBABILITY</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="hidden lg:flex items-center justify-center">
        <div className="w-full max-w-[420px] aspect-square border border-hairline-strong relative overflow-hidden bg-[#F7F7F5] flex items-center justify-center">
          <div className="absolute w-3 h-3 top-3 left-3 flex">
            <div className="absolute w-[2px] h-[12px] top-0 left-0 bg-[#1A3C2B] opacity-50"></div>
            <div className="absolute w-[12px] h-[2px] top-0 left-0 bg-[#1A3C2B] opacity-50"></div>
          </div>
          <div className="absolute w-3 h-3 top-3 right-3 flex">
            <div className="absolute w-[2px] h-[12px] top-0 right-0 bg-[#1A3C2B] opacity-50"></div>
            <div className="absolute w-[12px] h-[2px] top-0 right-0 bg-[#1A3C2B] opacity-50"></div>
          </div>
          <div className="absolute w-3 h-3 bottom-3 left-3 flex">
            <div className="absolute w-[2px] h-[12px] bottom-0 left-0 bg-[#1A3C2B] opacity-50"></div>
            <div className="absolute w-[12px] h-[2px] bottom-0 left-0 bg-[#1A3C2B] opacity-50"></div>
          </div>
          <div className="absolute w-3 h-3 bottom-3 right-3 flex">
            <div className="absolute w-[2px] h-[12px] bottom-0 right-0 bg-[#1A3C2B] opacity-50"></div>
            <div className="absolute w-[12px] h-[2px] bottom-0 right-0 bg-[#1A3C2B] opacity-50"></div>
          </div>
          
          <div className="absolute w-[70%] h-[70%] rounded-full border border-dashed border-[#1A3C2B]/20 animate-[spin_20s_linear_infinite]"></div>
          <div className="absolute w-[42%] h-[42%] rounded-full border border-dashed border-[#1A3C2B]/20 animate-[spin_15s_linear_infinite_reverse]"></div>
          
          <div className="absolute w-[14%] h-[14%] bg-[#1A3C2B] z-10 flex items-center justify-center">
            <div className="w-1 h-1 bg-white opacity-50"></div>
          </div>
          
          <div className="absolute w-2 h-2 bg-[#FF8C69] top-[25%] left-[25%]"></div>
          <div className="absolute w-2 h-2 bg-[#9EFFBF] bottom-[25%] right-[25%]"></div>
          
          <div className="absolute bottom-4 left-4 font-mono text-[9px] uppercase tracking-wider opacity-40">
            AUDIO ANALYSIS
          </div>
          <div className="absolute top-4 right-4 font-mono text-[9px] opacity-35 tracking-wider">
            X:-101 Y:404
          </div>
        </div>
      </div>
    </section>
  );
};
