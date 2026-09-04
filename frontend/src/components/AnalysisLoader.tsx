import React, { useEffect, useState } from 'react';

export const AnalysisLoader: React.FC = () => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 2000);
    const t2 = setTimeout(() => setStep(2), 4500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="w-full border border-hairline-strong bg-[#F7F7F5] p-12 lg:p-24 flex flex-col items-center justify-center text-center">
      <div className="font-mono text-[14px] uppercase tracking-widest text-[#1A3C2B] mb-8">
        ANALYZING AUDIO
      </div>
      
      {/* Indicator */}
      <div className="font-mono text-[16px] tracking-widest text-[#1A3C2B]/70 mb-8 animate-pulse">
        [■■■□□□□□□□]
      </div>

      <div className="flex flex-col gap-2 font-mono text-[11px] uppercase tracking-wider text-left max-w-xs mx-auto border-l-2 border-[#1A3C2B] pl-4">
        <div className={`transition-opacity ${step >= 0 ? 'opacity-100 text-[#1A3C2B]' : 'opacity-30'}`}>
          <div className="font-bold">PREPROCESSING</div>
          <div className="opacity-60">FFMPEG</div>
        </div>
        <div className={`transition-opacity ${step >= 1 ? 'opacity-100 text-[#1A3C2B]' : 'opacity-30'}`}>
          <div className="font-bold mt-2">ANALYZING</div>
          <div className="opacity-60">PELLAV2</div>
        </div>
        <div className={`transition-opacity ${step >= 2 ? 'opacity-100 text-[#1A3C2B]' : 'opacity-30'}`}>
          <div className="font-bold mt-2">ASSESSING RISK</div>
          <div className="opacity-60">GENERATING REPORT</div>
        </div>
      </div>
    </div>
  );
};
