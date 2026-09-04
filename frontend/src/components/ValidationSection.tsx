import React from 'react';

export const ValidationSection: React.FC = () => {
  return (
    <section className="py-20 lg:py-32 px-8 md:px-[64px] border-b border-hairline bg-[#1A3C2B]/5">
      <div className="flex flex-col lg:flex-row gap-16 lg:gap-32">
        <div className="flex-1">
          <span className="font-mono text-[10px] uppercase tracking-widest opacity-50 mb-4 block">06 / INITIAL VALIDATION</span>
          <h2 className="font-grotesk text-[32px] font-bold text-[#1A3C2B] leading-[1.1] mb-6">
            Development Tests
          </h2>
          <p className="font-sans text-[14px] opacity-70 leading-relaxed mb-8 max-w-sm">
            Initial validation only — not a formal benchmark. Testing existing Pellav2 detector performance against sample recordings.
          </p>
        </div>

        <div className="flex-[2_2_0] grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#F7F7F5] border border-hairline-strong p-6">
            <div className="font-mono text-[10px] opacity-50 mb-2">HUMAN WAV</div>
            <div className="font-mono text-[14px] text-[#1A3C2B] mb-4">p_fake ≈ 0.102</div>
            <div className="font-mono text-[10px] bg-[#9EFFBF]/30 text-[#1A3C2B] px-3 py-1 inline-block">LIKELY REAL</div>
          </div>
          <div className="bg-[#F7F7F5] border border-hairline-strong p-6">
             <div className="font-mono text-[10px] opacity-50 mb-2">HUMAN MP3</div>
             <div className="font-mono text-[14px] text-[#1A3C2B] mb-4">p_fake ≈ 0.104</div>
             <div className="font-mono text-[10px] bg-[#9EFFBF]/30 text-[#1A3C2B] px-3 py-1 inline-block">LIKELY REAL</div>
          </div>
          <div className="bg-[#F7F7F5] border border-hairline-strong p-6">
             <div className="font-mono text-[10px] opacity-50 mb-2">AI-GENERATED AUDIO</div>
             <div className="font-mono text-[14px] text-[#1A3C2B] mb-4">p_fake ≈ 1.000</div>
             <div className="font-mono text-[10px] bg-[#FF8C69]/30 text-[#1A3C2B] px-3 py-1 inline-block">LIKELY AI-GENERATED</div>
          </div>
        </div>
      </div>
    </section>
  );
};
