import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { api, getWsUrl } from '../services/api';
import type { PhoneConnectionState } from '../types';

interface Props {
  onClose: () => void;
  onStateChange?: (state: PhoneConnectionState) => void;
}

interface TelemetryData {
  state: string;
  client_count: number;
  frames: number;
  bytes: number;
  level: number;
  duration_s: number;
  token?: string;
}

export const PhoneConnectModal: React.FC<Props> = ({ onClose, onStateChange }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Default to LAN IP with HTTPS protocol (NEVER localhost for phone QR code)
  const [mobileUrl, setMobileUrl] = useState<string>('https://10.83.191.174:8443/mobile');
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    state: 'disconnected',
    client_count: 0,
    frames: 0,
    bytes: 0,
    level: 0,
    duration_s: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchInfo() {
      try {
        const [sessionData, ipData] = await Promise.all([
          api.getSessionToken().catch(() => null),
          api.getLocalIp().catch(() => null),
        ]);

        if (!mounted) return;

        // Force LAN IP (e.g. 10.83.191.174), ignore localhost
        let targetIp = ipData?.ip || '10.83.191.174';
        if (targetIp === 'localhost' || targetIp === '127.0.0.1') {
          targetIp = '10.83.191.174';
        }

        const port = ipData?.port || 8443;
        const tokenParam = sessionData?.token ? `?token=${sessionData.token}` : '';

        // REQUIREMENT 7: Always generate HTTPS QR code with LAN IP
        const finalUrl = `https://${targetIp}:${port}/mobile${tokenParam}`;
        setMobileUrl(finalUrl);
      } catch {
        // Fallback default HTTPS LAN IP
        setMobileUrl('https://10.83.191.174:8443/mobile');
      }
    }

    fetchInfo();

    return () => {
      mounted = false;
    };
  }, []);

  // Draw QR code onto canvas whenever mobileUrl changes
  useEffect(() => {
    if (!mobileUrl || !canvasRef.current) return;

    QRCode.toCanvas(
      canvasRef.current,
      mobileUrl,
      {
        width: 220,
        margin: 2,
        color: { dark: '#1A3C2B', light: '#FFF6E5' },
      },
      (err) => {
        if (err) console.error('QR Code render error:', err);
      }
    );
  }, [mobileUrl]);

  // Connect laptop telemetry subscriber WebSocket
  useEffect(() => {
    const wsUrl = getWsUrl('/ws/phone?role=laptop');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'TELEMETRY') {
          setTelemetry({
            state: data.state,
            client_count: data.client_count,
            frames: data.frames || 0,
            bytes: data.bytes || 0,
            level: data.level || 0,
            duration_s: data.duration_s || 0,
            token: data.token,
          });

          let st: PhoneConnectionState = 'disconnected';
          if (data.state === 'connected') st = 'connected';
          else if (data.state === 'mic_ready') st = 'mic_ready';
          else if (data.state === 'streaming') st = 'streaming';

          if (onStateChange) onStateChange(st);
        }
      } catch { /* ignore */ }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, [onStateChange]);

  const fmtBytes = (b: number) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  const isConnected = telemetry.client_count > 0 || ['connected', 'mic_ready', 'streaming', 'stopped'].includes(telemetry.state);
  const isMicReady = ['mic_ready', 'streaming', 'stopped'].includes(telemetry.state);
  const isReceiving = telemetry.state === 'streaming' && telemetry.frames > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-[#FFF6E5] border-2 border-[#1A3C2B] p-6 max-w-[580px] w-full flex flex-col gap-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 font-mono text-[14px] text-[#1A3C2B] hover:opacity-60 transition-opacity font-bold"
        >
          [ X ]
        </button>

        <div className="flex flex-col gap-1 border-b border-[#1A3C2B]/15 pb-4">
          <h3 className="font-grotesk text-[22px] font-bold text-[#1A3C2B] uppercase tracking-wide">
            CONNECT PHONE MICROPHONE
          </h3>
          <p className="font-sans text-[12px] opacity-75">
            Scan the QR code with your phone or open the HTTPS URL below on your mobile browser.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-6 items-center">
          {/* QR Code Canvas */}
          <div className="flex flex-col items-center gap-2 border border-[#1A3C2B]/20 p-3 bg-[#FFF6E5]">
            <canvas ref={canvasRef} width={220} height={220} className="w-[220px] h-[220px] block" />
            <span className="font-mono text-[9px] uppercase tracking-widest opacity-60">Scan to Open Secure Mobile Page</span>
          </div>

          {/* Status & Live Telemetry metrics */}
          <div className="flex flex-col gap-4 flex-1 w-full">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between border-b border-[#1A3C2B]/10 pb-2">
                <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">PHONE CONNECTION</span>
                <span className={`font-mono text-[11px] font-bold ${isConnected ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                  {isConnected ? '🟢 Phone connected' : '🔴 Phone disconnected'}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-[#1A3C2B]/10 pb-2">
                <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">MICROPHONE PERMISSION</span>
                <span className={`font-mono text-[11px] font-bold ${isMicReady ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                  {isMicReady ? '🟢 Permission granted' : '🔴 Not requested'}
                </span>
              </div>

              <div className="flex items-center justify-between border-b border-[#1A3C2B]/10 pb-2">
                <span className="font-mono text-[11px] uppercase tracking-wider opacity-70">AUDIO STREAM</span>
                <span className={`font-mono text-[11px] font-bold ${isReceiving ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                  {isReceiving ? '🟢 Receiving' : '🔴 Not receiving'}
                </span>
              </div>
            </div>

            <div className="bg-[#1A3C2B]/5 border border-[#1A3C2B]/15 p-3 flex flex-col gap-2">
              <span className="font-mono text-[9px] uppercase tracking-widest opacity-60">Real-Time Stream Telemetry</span>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div>
                  <span className="opacity-50 block text-[9px]">FRAMES</span>
                  <strong className="text-[#1A3C2B] font-bold text-[14px]">{telemetry.frames.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="opacity-50 block text-[9px]">BYTES</span>
                  <strong className="text-[#1A3C2B] font-bold text-[14px]">{fmtBytes(telemetry.bytes)}</strong>
                </div>
              </div>

              <div className="flex flex-col gap-1 mt-1">
                <span className="font-mono text-[9px] uppercase tracking-wider opacity-50">AUDIO LEVEL</span>
                <div className="h-2 bg-[#1A3C2B]/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#1A3C2B] transition-all duration-75 rounded-full"
                    style={{ width: `${telemetry.level}%` }}
                  />
                </div>
              </div>
            </div>

            {mobileUrl && (
              <div className="flex flex-col gap-1 border-t border-[#1A3C2B]/10 pt-2">
                <span className="font-mono text-[9px] uppercase tracking-widest opacity-50">Direct Mobile URL</span>
                <a
                  href={mobileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11px] text-[#1A3C2B] underline break-all hover:opacity-75 font-bold"
                >
                  {mobileUrl}
                </a>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-[#1A3C2B]/15 pt-4">
          <button
            onClick={onClose}
            className="bg-[#1A3C2B] text-[#FFF6E5] px-6 py-2.5 font-mono text-[12px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors"
          >
            [ CLOSE ]
          </button>
        </div>
      </div>
    </div>
  );
};
