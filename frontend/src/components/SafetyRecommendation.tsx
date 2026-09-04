import React from 'react';

interface SafetyRecommendationProps {
  isFake: boolean;
}

export const SafetyRecommendation: React.FC<SafetyRecommendationProps> = ({ isFake }) => {
  return (
    <div className={`mt-8 border p-6 font-sans text-sm leading-relaxed ${isFake ? 'border-[#FF8C69]/50 bg-[#FF8C69]/5' : 'border-hairline-strong bg-transparent'}`}>
      <div className="font-mono text-[10px] uppercase tracking-widest opacity-60 mb-3">
        SAFETY RECOMMENDATION
      </div>
      {isFake ? (
        <p>This recording shows signals associated with synthetic speech. Independently verify the request before transferring money, sharing credentials, or providing sensitive information.</p>
      ) : (
        <p>Voice analysis alone cannot verify the caller's identity. Independently verify sensitive requests through a trusted channel.</p>
      )}
    </div>
  );
};
