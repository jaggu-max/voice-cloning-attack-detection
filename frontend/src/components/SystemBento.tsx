import React from 'react';

export const SystemBento: React.FC = () => {
  return (
    <section id="about" className="pt-20 pb-0 border-b border-hairline">
      <div className="px-8 md:px-[64px] mb-12">
        <span className="font-mono text-[10px] uppercase tracking-widest opacity-50 mb-4 block">05 / SYSTEM</span>
        <h2 className="font-grotesk text-[36px] md:text-[48px] font-bold text-[#1A3C2B] leading-[1.1]">Technical Architecture</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-[#3A3A38]/20 border-t border-hairline">
        <div className="bg-[#F7F7F5] p-12 lg:p-16 min-h-[300px]">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider mb-6">
             <div className="w-[3px] h-[14px] bg-[#FF8C69]"></div>
             DETECTION ENGINE
          </div>
          <h3 className="font-grotesk text-[28px] font-bold text-[#1A3C2B] mb-4">Pellav2</h3>
          <p className="font-sans text-[14px] opacity-70 leading-relaxed">
            Audio deepfake detection model based on wav2vec2 architecture. Analyzes hidden states to detect artifacts indicative of synthetic generation.
          </p>
        </div>
        
        <div className="bg-[#F7F7F5] p-12 lg:p-16 min-h-[300px]">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider mb-6">
             <div className="w-[3px] h-[14px] bg-[#9EFFBF]"></div>
             PREPROCESSING
          </div>
          <h3 className="font-grotesk text-[28px] font-bold text-[#1A3C2B] mb-4">FFMPEG</h3>
          <p className="font-sans text-[14px] opacity-70 leading-relaxed">
            Audio preprocessing and format conversion pipeline. Normalizes input to 16 kHz mono PCM WAV format for precise model inference.
          </p>
        </div>
        
        <div className="bg-[#F7F7F5] p-12 lg:p-16 min-h-[300px]">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider mb-6">
             <div className="w-[3px] h-[14px] bg-[#F4D35E]"></div>
             SUPPORTED INPUT
          </div>
          <h3 className="font-grotesk text-[28px] font-bold text-[#1A3C2B] mb-4">MP3 / WAV</h3>
          <p className="font-sans text-[14px] opacity-70 leading-relaxed">
            Handles standard audio formats. Robust preprocessing ensures reliable conversion prior to analysis by the classification engine.
          </p>
        </div>
        
        <div className="bg-[#F7F7F5] p-12 lg:p-16 min-h-[300px]">
          <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider mb-6">
             <div className="w-[3px] h-[14px] bg-[#1A3C2B]"></div>
             API LAYER
          </div>
          <h3 className="font-grotesk text-[28px] font-bold text-[#1A3C2B] mb-4">FASTAPI</h3>
          <p className="font-sans text-[14px] opacity-70 leading-relaxed">
            Backend inference API. Integrates heavy ML workloads with scalable, asynchronous endpoints for web applications.
          </p>
        </div>
      </div>
    </section>
  );
};
