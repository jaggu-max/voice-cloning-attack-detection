import React, { useCallback, useState } from 'react';

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ onFileSelect }) => {
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelect(e.dataTransfer.files[0]);
    }
  }, [onFileSelect]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div 
      className={`relative w-full p-12 lg:p-24 border transition-colors cursor-pointer group flex flex-col items-center justify-center text-center outline-none focus-visible:ring-2 focus-visible:ring-[#1A3C2B] ${
        isDragActive ? 'border-[#1A3C2B] bg-[#1A3C2B]/5' : 'border-hairline-strong bg-[#F7F7F5]'
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      onClick={() => document.getElementById('audio-upload')?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('audio-upload')?.click() }}
      tabIndex={0}
      role="button"
      aria-label="Upload audio file"
    >
      <input
        id="audio-upload"
        type="file"
        className="hidden"
        accept=".mp3,.wav,.ogg,.flac,.m4a"
        onChange={handleChange}
        tabIndex={-1}
      />

      {/* L-shaped corners */}
      <div className="absolute w-[10px] h-[10px] top-[-1px] left-[-1px]">
        <div className={`absolute w-[2px] h-[10px] top-0 left-0 transition-colors ${isDragActive ? 'bg-[#1A3C2B]' : 'bg-[#1A3C2B]/50'}`}></div>
        <div className={`absolute w-[10px] h-[2px] top-0 left-0 transition-colors ${isDragActive ? 'bg-[#1A3C2B]' : 'bg-[#1A3C2B]/50'}`}></div>
      </div>
      <div className="absolute w-[10px] h-[10px] top-[-1px] right-[-1px]">
        <div className={`absolute w-[2px] h-[10px] top-0 right-0 transition-colors ${isDragActive ? 'bg-[#1A3C2B]' : 'bg-[#1A3C2B]/50'}`}></div>
        <div className={`absolute w-[10px] h-[2px] top-0 right-0 transition-colors ${isDragActive ? 'bg-[#1A3C2B]' : 'bg-[#1A3C2B]/50'}`}></div>
      </div>
      <div className="absolute w-[10px] h-[10px] bottom-[-1px] left-[-1px]">
        <div className={`absolute w-[2px] h-[10px] bottom-0 left-0 transition-colors ${isDragActive ? 'bg-[#1A3C2B]' : 'bg-[#1A3C2B]/50'}`}></div>
        <div className={`absolute w-[10px] h-[2px] bottom-0 left-0 transition-colors ${isDragActive ? 'bg-[#1A3C2B]' : 'bg-[#1A3C2B]/50'}`}></div>
      </div>
      <div className="absolute w-[10px] h-[10px] bottom-[-1px] right-[-1px]">
        <div className={`absolute w-[2px] h-[10px] bottom-0 right-0 transition-colors ${isDragActive ? 'bg-[#1A3C2B]' : 'bg-[#1A3C2B]/50'}`}></div>
        <div className={`absolute w-[10px] h-[2px] bottom-0 right-0 transition-colors ${isDragActive ? 'bg-[#1A3C2B]' : 'bg-[#1A3C2B]/50'}`}></div>
      </div>

      <div className="font-mono text-[14px] uppercase tracking-widest text-[#1A3C2B] mb-4">
        UPLOAD AUDIO
      </div>
      <div className="font-sans text-lg opacity-80 mb-6 group-hover:text-[#1A3C2B] transition-colors">
        Drag & drop your file here
      </div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-[#1A3C2B] border border-[#1A3C2B]/20 px-6 py-3 mb-10 group-hover:bg-[#1A3C2B]/5 transition-colors">
        [ BROWSE FILE ]
      </div>
      <div className="grid grid-cols-2 gap-8 text-left border-t border-hairline-strong pt-6">
        <div>
          <div className="font-mono text-[10px] uppercase opacity-50 mb-1 tracking-wider">MAX FILE SIZE</div>
          <div className="font-mono text-[11px]">50 MB</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase opacity-50 mb-1 tracking-wider">SUPPORTED FORMATS</div>
          <div className="font-mono text-[11px]">MP3 / WAV</div>
        </div>
      </div>
    </div>
  );
};
