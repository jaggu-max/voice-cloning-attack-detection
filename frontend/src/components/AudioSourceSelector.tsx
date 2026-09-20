import React from 'react';
import type { AudioSource } from '../types';

interface Props {
  value: AudioSource;
  onChange: (source: AudioSource) => void;
  disabled?: boolean;
}

const OPTIONS: { value: AudioSource; label: string; sub: string }[] = [
  { value: 'laptop',     label: 'Laptop Microphone', sub: 'Built-in or USB microphone' },
  { value: 'phone-wifi', label: 'Phone — Wi-Fi',      sub: 'Stream over hotspot (WebSocket)' },
  { value: 'phone-usb',  label: 'Phone — USB',        sub: 'USB bridge via ADB tunnel' },
];

export const AudioSourceSelector: React.FC<Props> = ({ value, onChange, disabled }) => (
  <div className="flex flex-col gap-3">
    <div className="font-mono text-[10px] uppercase tracking-widest opacity-55 border-b border-[#1A3C2B]/10 pb-2">
      Audio Source
    </div>
    <div className="flex flex-col gap-0 border border-[#1A3C2B]/20">
      {OPTIONS.map((opt, i) => {
        const selected = value === opt.value;
        return (
          <label
            key={opt.value}
            className={`flex items-center gap-4 px-5 py-4 cursor-pointer transition-colors select-none
              ${selected ? 'bg-[#1A3C2B] text-[#FFF6E5]' : 'bg-white/60 text-[#1A3C2B] hover:bg-[#1A3C2B]/5'}
              ${i < OPTIONS.length - 1 ? 'border-b border-[#1A3C2B]/15' : ''}
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="audio-source"
              value={opt.value}
              checked={selected}
              disabled={disabled}
              onChange={() => !disabled && onChange(opt.value)}
              className="sr-only"
            />
            {/* Custom radio circle */}
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
              ${selected ? 'border-[#9EFFBF]' : 'border-[#1A3C2B]/40'}`}>
              {selected && <div className="w-2 h-2 rounded-full bg-[#9EFFBF]" />}
            </div>
            <div className="flex flex-col">
              <span className="font-mono text-[12px] font-bold uppercase tracking-wider">
                {opt.label}
              </span>
              <span className={`font-sans text-[11px] mt-0.5 ${selected ? 'opacity-70' : 'opacity-50'}`}>
                {opt.sub}
              </span>
            </div>
          </label>
        );
      })}
    </div>
  </div>
);
