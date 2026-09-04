import React from 'react';

interface ProbabilityMeterProps {
  score: number; // 0 to 1
}

export const ProbabilityMeter: React.FC<ProbabilityMeterProps> = ({ score }) => {
  const percentage = (score * 100).toFixed(1);
  const leftPosition = `${Math.min(100, Math.max(0, score * 100))}%`;

  return (
    <div className="w-full mt-10 mb-8">
      <div className="relative h-2 w-full bg-[#1A3C2B]/10 border-y border-[#1A3C2B]/20 mb-4">
        <div 
          className="absolute top-[0px] w-[2px] h-[8px] bg-[#1A3C2B] z-10 transition-all duration-1000 ease-out"
          style={{ left: leftPosition, transform: 'translateX(-50%)' }}
        >
          <div className="absolute top-[-10px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-r-[4px] border-b-[6px] border-transparent border-b-[#1A3C2B]"></div>
          <div className="absolute top-[-24px] left-1/2 -translate-x-1/2 font-mono text-[10px] font-bold text-[#1A3C2B]">
            {percentage}%
          </div>
        </div>
      </div>
      <div className="flex justify-between font-mono text-[9px] uppercase tracking-widest opacity-50">
        <div>0% — REAL</div>
        <div>100% — AI-GENERATED</div>
      </div>
    </div>
  );
};
