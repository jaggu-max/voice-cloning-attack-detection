import React, { useEffect, useState } from 'react';

interface AudioPreviewProps {
  file: File;
  onAnalyze: () => void;
  onRemove: () => void;
}

export const AudioPreview: React.FC<AudioPreviewProps> = ({ file, onAnalyze, onRemove }) => {
  const [objectUrl, setObjectUrl] = useState<string>('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="w-full border border-hairline-strong bg-paper p-8 lg:p-12 relative overflow-hidden">
      <div className="absolute top-0 left-0 bg-[#1A3C2B] text-white font-mono text-[9px] uppercase px-3 py-1 tracking-widest">
        FILE SELECTED
      </div>
      
      <div className="mt-6 mb-8 font-mono">
        <div className="text-[14px] font-bold text-[#1A3C2B] mb-4 break-all">{file.name}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-[10px] uppercase tracking-wider opacity-60">
          <div>
            <div className="opacity-50">SIZE</div>
            <div>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
          </div>
          <div>
            <div className="opacity-50">TYPE</div>
            <div>{file.type || file.name.split('.').pop()?.toUpperCase()}</div>
          </div>
        </div>
      </div>

      <div className="mb-8 w-full bg-[#1A3C2B]/5 border border-[#1A3C2B]/10 h-[60px] flex items-center justify-center p-2 relative overflow-hidden">
        {/* Abstract waveform mock using CSS for technical feel */}
        <div className="flex items-center gap-[2px] w-full h-full justify-center opacity-30 px-4 mt-2">
          {[...Array(60)].map((_, i) => (
             <div key={i} className="w-[2px] bg-[#1A3C2B]" style={{ height: `${Math.max(10, Math.random() * 100)}%` }}></div>
          ))}
        </div>
        <div className="absolute inset-0 flex flex-col justify-center px-4 mix-blend-multiply">
           {objectUrl && <audio src={objectUrl} controls className="w-full h-8 outline-none opacity-80" />}
        </div>
      </div>

      <div className="flex gap-4">
        <button 
          onClick={onAnalyze}
          className="flex-1 bg-[#1A3C2B] text-white border-none py-4 font-mono text-[12px] uppercase tracking-widest hover:opacity-90 transition-opacity cursor-pointer"
        >
          [ ANALYZE AUDIO ]
        </button>
        <button 
          onClick={onRemove}
          className="px-8 border border-hairline-strong bg-transparent font-mono text-[12px] uppercase tracking-widest text-[#1A3C2B] hover:bg-[#1A3C2B]/5 transition-colors cursor-pointer"
        >
          [ REMOVE ]
        </button>
      </div>
    </div>
  );
};
