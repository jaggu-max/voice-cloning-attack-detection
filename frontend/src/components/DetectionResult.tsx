import React from 'react';
import type { AnalysisResult } from '../types';
import { ProbabilityMeter } from './ProbabilityMeter';
import { SafetyRecommendation } from './SafetyRecommendation';

interface DetectionResultProps {
  result: AnalysisResult;
  onReset: () => void;
}

export const DetectionResult: React.FC<DetectionResultProps> = ({ result, onReset }) => {
  const isFake = result.p_fake >= 0.5;
  const accentColor = isFake ? '#FF8C69' : '#9EFFBF';

  return (
    <div className="w-full border border-hairline-strong bg-[#F7F7F5] relative overflow-hidden">
      <div className="absolute top-0 left-0 bg-[#1A3C2B] text-white font-mono text-[9px] uppercase px-3 py-1 tracking-widest">
        03 / DETECTION RESULT
      </div>

      <div className="p-8 lg:p-12 pt-16">
        <div className="mb-12">
          <div className="font-mono text-[12px] uppercase tracking-widest opacity-50 mb-2">MODEL SCORE</div>
          <div className="font-mono text-[42px] leading-none text-[#1A3C2B] font-bold">
            {result.p_fake.toFixed(3)}
          </div>
        </div>

        <div className="mb-12 border-l-4 pl-6 py-2" style={{ borderColor: accentColor }}>
          <div className="font-sans text-[32px] md:text-[48px] font-bold tracking-tight text-[#1A3C2B] leading-none mb-2">
            {result.label}
          </div>
          <div className="font-mono text-[11px] uppercase tracking-widest opacity-60">
            AI-GENERATED PROBABILITY: {(result.p_fake * 100).toFixed(1)}%
          </div>
        </div>

        <ProbabilityMeter score={result.p_fake} />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-y-6 gap-x-4 border-t border-b border-hairline py-6 font-mono text-[10px] uppercase tracking-wider mt-8">
          <div className="lg:col-span-2">
            <div className="opacity-40 mb-1">FILE</div>
            <div className="text-[#1A3C2B] truncate pr-4" title={result.filename}>{result.filename}</div>
          </div>
          <div>
            <div className="opacity-40 mb-1">FORMAT</div>
            <div className="text-[#1A3C2B]">{result.filename.split('.').pop()?.toUpperCase() || 'AUDIO'}</div>
          </div>
          <div>
            <div className="opacity-40 mb-1">MODEL</div>
            <div className="text-[#1A3C2B]">PELLAV2</div>
          </div>
          <div>
            <div className="opacity-40 mb-1">CLASSIFICATION</div>
            <div className="text-[#1A3C2B]">{result.classification.replace('_', ' ')}</div>
          </div>
        </div>

        <SafetyRecommendation isFake={isFake} />
        
        <div className="mt-8 text-center pt-8 border-t border-hairline">
           <button 
             onClick={onReset}
             className="bg-[#1A3C2B] text-white font-mono text-[11px] px-8 py-3 uppercase tracking-widest hover:opacity-90 transition-opacity border-none cursor-pointer"
           >
             [ ANALYZE ANOTHER FILE ]
           </button>
        </div>
      </div>
    </div>
  );
};
