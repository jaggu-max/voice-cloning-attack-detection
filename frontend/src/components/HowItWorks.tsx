import React from 'react';

export const HowItWorks: React.FC = () => {
  return (
    <section id="how-it-works" className="py-20 lg:py-32 px-8 md:px-[64px] border-b border-hairline">
      <div className="mb-16">
        <span className="font-mono text-[10px] uppercase tracking-widest opacity-50 mb-4 block">04 / HOW IT WORKS</span>
        <h2 className="font-grotesk text-[36px] md:text-[48px] font-bold text-[#1A3C2B] leading-[1.1]">The Analysis Protocol</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { step: '01', title: 'UPLOAD', desc: 'User provides MP3 or WAV audio recording.' },
          { step: '02', title: 'PREPROCESS', desc: 'Audio is normalized and converted for detector input.' },
          { step: '03', title: 'ANALYZE', desc: 'Pellav2 analyzes speech characteristics associated with synthetic audio.' },
          { step: '04', title: 'ASSESS', desc: 'The system returns an AI-generated probability score.' }
        ].map((item, i) => (
          <div key={i} className="border border-hairline-strong bg-[#F7F7F5] p-8 flex flex-col pt-12 relative border-t-4 border-t-[#1A3C2B]">
            <div className="font-mono text-[24px] font-bold text-[#1A3C2B] opacity-20 absolute top-6 right-6">
              {item.step}
            </div>
            <h3 className="font-mono text-[12px] font-bold uppercase tracking-widest text-[#1A3C2B] mb-4">
              {item.title}
            </h3>
            <p className="font-sans text-[13px] opacity-70 leading-relaxed">
              {item.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
};
