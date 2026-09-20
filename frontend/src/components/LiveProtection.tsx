import React, { useState, useRef, useEffect, useCallback } from 'react';
import { api, getWsUrl } from '../services/api';
import { convertBlobToWav, triggerBlobDownload } from '../utils/wavExporter';
import type { LiveAnalysisResult, AnalysisResult, AudioSource, PhoneConnectionState } from '../types';
import { AudioSourceSelector } from './AudioSourceSelector';
import { PhoneConnectModal } from './PhoneConnectModal';

type LiveState = 'READY' | 'REQUESTING_PERMISSION' | 'RECORDING' | 'ANALYZING' | 'WARNING' | 'STOPPED' | 'ERROR';

interface TimelineItem extends LiveAnalysisResult {
  id: number;
  time: string;
  blob: Blob;
}

const USB_POLL_MS = 3000;

export const LiveProtection: React.FC = () => {
  const [audioSource, setAudioSource] = useState<AudioSource>('laptop');
  const [phoneState, setPhoneState] = useState<PhoneConnectionState>('disconnected');
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [usbState, setUsbState] = useState<'disconnected' | 'connected' | 'streaming' | 'error'>('disconnected');

  const [liveState, setLiveState] = useState<LiveState>('READY');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [segmentProgress, setSegmentProgress] = useState(0.0);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [isDownloadingFull, setIsDownloadingFull] = useState(false);

  const [fullAudioUrl, setFullAudioUrl] = useState<string | null>(null);
  const [fullAnalysisResult, setFullAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzingFull, setIsAnalyzingFull] = useState(false);

  // Phone Wi-Fi WebSocket ref (managed by modal)
  const phoneWsRef = useRef<WebSocket | null>(null);
  // Results from phone WebSocket
  const [phoneResult, setPhoneResult] = useState<LiveAnalysisResult | null>(null);

  // Laptop mic refs
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimerRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const segmentCounter = useRef(1);
  const isStoppingRef = useRef(false);
  const elapsedSecondsRef = useRef(0);
  const allChunksRef = useRef<BlobPart[]>([]);

  // Canvas / Waveform
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // USB polling
  const usbPollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopWaveform();
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (fullAudioUrl) URL.revokeObjectURL(fullAudioUrl);
      if (usbPollRef.current) clearInterval(usbPollRef.current);
    };
  }, [fullAudioUrl]);

  // USB polling when USB mode active
  useEffect(() => {
    if (audioSource === 'phone-usb') {
      usbPollRef.current = window.setInterval(async () => {
        try {
          const status = await api.getUsbStatus();
          setUsbState(status.state as typeof usbState);
          if (status.state === 'streaming' && status.last_audio_ts) {
            const age = Date.now() / 1000 - status.last_audio_ts;
            if (age > 10) setUsbState('connected'); // stale
          }
        } catch { /* backend unreachable */ }
      }, USB_POLL_MS);
    } else {
      if (usbPollRef.current) clearInterval(usbPollRef.current);
      setUsbState('disconnected');
    }
    return () => { if (usbPollRef.current) clearInterval(usbPollRef.current); };
  }, [audioSource]);

  // Listen for telemetry & live analysis results from phone WebSocket
  useEffect(() => {
    if (audioSource !== 'phone-wifi') return;

    const wsUrl = getWsUrl('/ws/phone?role=laptop');
    const ws = new WebSocket(wsUrl);
    phoneWsRef.current = ws;

    ws.onmessage = (evt: MessageEvent) => {
      try {
        const msg = JSON.parse(evt.data);

        if (msg.type === 'TELEMETRY') {
          let st: PhoneConnectionState = 'disconnected';
          if (msg.state === 'connected') st = 'connected';
          else if (msg.state === 'mic_ready') st = 'mic_ready';
          else if (msg.state === 'streaming') st = 'streaming';
          setPhoneState(st);

          if (msg.state === 'streaming' && liveState !== 'RECORDING' && liveState !== 'WARNING') {
            setLiveState('RECORDING');
          }
        } else if (msg.type === 'RESULT') {
          const result: LiveAnalysisResult = {
            window_start: elapsedSecondsRef.current,
            window_end: elapsedSecondsRef.current + 10,
            p_fake: msg.p_fake,
            classification: msg.classification,
            risk_level: msg.risk_level,
            model: 'pellav2',
            windows_analyzed: msg.windows_analyzed || 1,
            windows_speech: msg.windows_speech || 1,
            confidence: msg.confidence || Math.round(msg.p_fake * 100),
          };

          setPhoneResult(result);

          // Append to timeline display
          const dummyBlob = new Blob([], { type: 'audio/webm' });
          const item: TimelineItem = {
            ...result,
            id: Date.now(),
            time: new Date().toLocaleTimeString([], { hour12: false }),
            blob: dummyBlob,
          };

          setTimeline((prev) => [item, ...prev]);

          if (result.risk_level === 'high') {
            setLiveState('WARNING');
          } else {
            setLiveState('RECORDING');
          }

          elapsedSecondsRef.current += 10;
        }
      } catch { /* ignore */ }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
      phoneWsRef.current = null;
    };
  }, [audioSource]);

  // ── Waveform ──────────────────────────────────────────────────────────────
  const startWaveform = useCallback((stream: MediaStream) => {
    try {
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      sourceRef.current = source;
      drawWaveform();
    } catch (err) {
      console.error('Waveform error:', err);
    }
  }, []);

  const stopWaveform = useCallback(() => {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    if (sourceRef.current) { sourceRef.current.disconnect(); sourceRef.current = null; }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close(); audioCtxRef.current = null;
    }
    analyserRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height); }
  }, []);

  const drawWaveform = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bufferLength = analyser.frequencyBinCount;
    const freqData = new Uint8Array(bufferLength);
    const timeData = new Uint8Array(bufferLength);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(freqData);
      analyser.getByteTimeDomainData(timeData);
      const dpr = window.devicePixelRatio || 1;
      const displayW = canvas.clientWidth;
      const displayH = canvas.clientHeight;
      if (canvas.width !== displayW * dpr || canvas.height !== displayH * dpr) {
        canvas.width = displayW * dpr;
        canvas.height = displayH * dpr;
        ctx.scale(dpr, dpr);
      }
      const w = displayW; const h = displayH;
      ctx.clearRect(0, 0, w, h);
      const isWarning = document.querySelector('[data-live-warning]') !== null;
      const mainColor = isWarning ? '#FF8C69' : '#3E7D5C';
      const glowColor = isWarning ? 'rgba(255,140,105,0.4)' : 'rgba(62,125,92,0.4)';
      const numBars = 36; const barWidth = (w / numBars) - 3; let barX = 2;
      for (let i = 0; i < numBars; i++) {
        const amp = freqData[Math.floor((i / numBars) * bufferLength)] / 255.0;
        const barHeight = Math.max(4, amp * (h * 0.75));
        ctx.fillStyle = mainColor; ctx.shadowBlur = 6; ctx.shadowColor = glowColor;
        ctx.beginPath(); ctx.roundRect(barX, h - barHeight - 4, barWidth, barHeight, [3, 3, 0, 0]); ctx.fill();
        barX += barWidth + 3;
      }
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = isWarning ? 'rgba(255,140,105,0.8)' : 'rgba(158,255,191,0.9)';
      ctx.beginPath();
      const sliceWidth = w / bufferLength; let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = timeData[i] / 128.0; const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(w, h / 2); ctx.stroke();
    };
    draw();
  };

  const startProgressTimer = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setSegmentProgress(0);
    const t0 = Date.now();
    progressIntervalRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - t0) / 1000;
      setSegmentProgress(Math.min(elapsed, 10));
    }, 100);
  };

  const stopProgressTimer = () => {
    if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
  };

  // ── Laptop microphone recording loop ─────────────────────────────────────
  const startProtection = async () => {
    setLiveState('REQUESTING_PERMISSION');
    setErrorMsg(null);
    setTimeline([]);
    segmentCounter.current = 1;
    isStoppingRef.current = false;
    elapsedSecondsRef.current = 0;
    allChunksRef.current = [];
    if (fullAudioUrl) URL.revokeObjectURL(fullAudioUrl);
    setFullAudioUrl(null); setFullAnalysisResult(null); setIsAnalyzingFull(false);

    if (audioSource === 'laptop') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
        });
        streamRef.current = stream;
        startWaveform(stream);
        startRecordingLoop(stream);
      } catch {
        setLiveState('ERROR');
        setErrorMsg('Microphone permission was denied. Enable microphone access and try again.');
      }
    } else if (audioSource === 'phone-wifi') {
      if (phoneState !== 'streaming' && phoneState !== 'mic_ready' && phoneState !== 'connected') {
        setShowPhoneModal(true);
        setLiveState('READY');
        return;
      }
      setLiveState('RECORDING');
      // Phone sends audio via WebSocket; results come via useEffect above
    } else if (audioSource === 'phone-usb') {
      if (usbState === 'disconnected' || usbState === 'error') {
        setErrorMsg('USB Bridge not connected. Start the USB receiver and Android bridge app first.');
        setLiveState('ERROR');
        return;
      }
      setLiveState('RECORDING');
      // USB receiver pushes to /api/usb/stream; results show via USB polling
    }
  };

  const startRecordingLoop = (stream: MediaStream) => {
    if (isStoppingRef.current) return;
    setLiveState(prev => prev === 'WARNING' ? 'WARNING' : 'RECORDING');
    startProgressTimer();
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorderRef.current = recorder;
    const windowStart = elapsedSecondsRef.current;
    const windowEnd = windowStart + 10;
    let localChunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) { localChunks.push(e.data); allChunksRef.current.push(e.data); } };
    recorder.onstop = async () => {
      stopProgressTimer();
      if (localChunks.length > 0) {
        const audioBlob = new Blob(localChunks, { type: 'audio/webm' });
        if (audioBlob.size >= 10000 || !isStoppingRef.current) {
          const id = segmentCounter.current++;
          processSegment(audioBlob, id, windowStart, windowEnd);
        }
      }
      if (!isStoppingRef.current) { elapsedSecondsRef.current += 10; startRecordingLoop(stream); }
    };
    recorder.start();
    chunkTimerRef.current = window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 10000);
  };

  const processSegment = async (blob: Blob, segmentId: number, windowStart: number, windowEnd: number) => {
    setLiveState(prev => prev === 'RECORDING' ? 'ANALYZING' : prev);
    try {
      const result = await api.analyzeLiveAudio(blob, windowStart, windowEnd);
      const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
      const timeStr = `${fmt(result.window_start)}–${fmt(result.window_end)}`;
      setTimeline(prev => {
        const filtered = prev.filter(item => item.id !== segmentId);
        const updated = [...filtered, { ...result, id: segmentId, time: timeStr, blob }];
        return updated.sort((a, b) => b.id - a.id);
      });
      setLiveState(() => {
        if (isStoppingRef.current) return 'STOPPED';
        if (result.risk_level === 'high') return 'WARNING';
        return 'RECORDING';
      });
    } catch (e) { console.error('Segment analysis error:', e); }
  };

  const analyzeFullSession = async (blob: Blob) => {
    setIsAnalyzingFull(true);
    try {
      const file = new File([blob], 'voiceguard-live-full-session.webm', { type: blob.type || 'audio/webm' });
      const result = await api.analyzeAudio(file);
      setFullAnalysisResult(result);
    } catch (err) { console.error('Full session analysis error:', err); }
    finally { setIsAnalyzingFull(false); }
  };

  const stopProtection = () => {
    isStoppingRef.current = true;
    setLiveState('STOPPED');
    stopProgressTimer();
    if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    stopWaveform();
    setTimeout(() => {
      if (allChunksRef.current.length > 0) {
        const fullBlob = new Blob(allChunksRef.current, { type: 'audio/webm' });
        setFullAudioUrl(URL.createObjectURL(fullBlob));
        analyzeFullSession(fullBlob);
      }
    }, 400);
  };

  // ── Download helpers ──────────────────────────────────────────────────────
  const handleDownloadSegmentMp3 = async (item: TimelineItem) => {
    setDownloadingId(item.id);
    try {
      const mp3Blob = await api.downloadLiveMp3(item.blob);
      triggerBlobDownload(mp3Blob, `voiceguard-segment-${String(item.id).padStart(2, '0')}-${item.classification}.mp3`);
    } catch {
      try {
        const wavBlob = await convertBlobToWav(item.blob);
        triggerBlobDownload(wavBlob, `voiceguard-segment-${String(item.id).padStart(2, '0')}-${item.classification}.wav`);
      } catch { alert('Could not download audio file.'); }
    } finally { setDownloadingId(null); }
  };

  const handleDownloadFullSessionMp3 = async () => {
    if (timeline.length === 0) return;
    setIsDownloadingFull(true);
    try {
      const blobs = [...timeline].sort((a, b) => a.id - b.id).map(i => i.blob);
      const blob = await api.downloadFullLiveMp3(blobs);
      triggerBlobDownload(blob, `voiceguard-full-session-${timeline.length}segments.mp3`);
    } catch { alert('Could not generate full session MP3.'); }
    finally { setIsDownloadingFull(false); }
  };

  const getStatusDisplay = () => {
    switch (liveState) {
      case 'READY': return '● DISCONNECTED';
      case 'REQUESTING_PERMISSION': return '● CONNECTING...';
      case 'RECORDING': return '● LIVE AUDIO CAPTURE';
      case 'ANALYZING': return '● ANALYZING PELLAV2';
      case 'WARNING': return '⚠ POTENTIAL VOICE-CLONING IMPERSONATION';
      case 'STOPPED': return '● LIVE PROTECTION STOPPED';
      case 'ERROR': return '● ERROR';
    }
  };

  const isActive = liveState === 'RECORDING' || liveState === 'ANALYZING' || liveState === 'WARNING';
  const progressPercent = Math.min(100, (segmentProgress / 10.0) * 100);

  // Connection status for phone/usb modes
  const srcStatusColor = (ok: boolean) => ok ? 'text-[#22c55e]' : 'text-[#ef4444]';
  const phoneOk = ['connected', 'mic_ready', 'streaming'].includes(phoneState);

  return (
    <div className="flex flex-col gap-8 w-full max-w-[800px] mx-auto p-0">
      {showPhoneModal && (
        <PhoneConnectModal
          onClose={() => setShowPhoneModal(false)}
          onStateChange={(s) => setPhoneState(s)}
        />
      )}

      <div className="flex flex-col gap-4 text-center">
        <h2 className="font-grotesk text-[32px] md:text-[36px] font-bold text-[#1A3C2B]">LIVE PROTECTION</h2>
        <p className="font-sans text-[14px] opacity-70 max-w-[480px] mx-auto">
          Microphone audio is captured in real-time 10-second windows and analyzed by VoiceGuard.
          <br />VoiceGuard detection is probabilistic and powered by Pellav2 Wav2Vec2 hidden states.
        </p>
      </div>

      {/* Audio source selector */}
      <div className="border border-[#1A3C2B]/20 p-6 bg-white/50 backdrop-blur">
        <AudioSourceSelector
          value={audioSource}
          onChange={(s) => { setAudioSource(s); setLiveState('READY'); setErrorMsg(null); }}
          disabled={isActive}
        />

        {/* Phone Wi-Fi status row */}
        {audioSource === 'phone-wifi' && (
          <div className="mt-4 flex items-center justify-between border-t border-[#1A3C2B]/10 pt-4 gap-3">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-60">Phone Connection</span>
              <span className={`font-mono text-[12px] font-bold ${srcStatusColor(phoneOk)}`}>
                {phoneOk ? '🟢' : '🔴'} {phoneState === 'streaming' ? 'Audio Receiving' : phoneState === 'mic_ready' ? 'Mic Ready' : phoneState === 'connected' ? 'Connected' : phoneState === 'connecting' ? 'Connecting...' : 'Not Connected'}
              </span>
            </div>
            <button
              onClick={() => setShowPhoneModal(true)}
              className="bg-[#1A3C2B] text-[#FFF6E5] px-5 py-2.5 font-mono text-[11px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors"
            >
              [ CONNECT PHONE ]
            </button>
          </div>
        )}

        {/* USB status row */}
        {audioSource === 'phone-usb' && (
          <div className="mt-4 border-t border-[#1A3C2B]/10 pt-4 flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-60">USB Bridge Status</span>
            <span className={`font-mono text-[12px] font-bold ${srcStatusColor(usbState !== 'disconnected' && usbState !== 'error')}`}>
              {usbState === 'streaming' ? '🟢 Audio Receiving' :
               usbState === 'connected' ? '🟢 Bridge Connected' :
               usbState === 'error'     ? '🔴 Bridge Error' :
               '🔴 USB Bridge Not Connected'}
            </span>
            {usbState === 'disconnected' && (
              <p className="font-sans text-[12px] opacity-60">
                Start <code className="bg-black/5 px-1 rounded">python usb_receiver/receiver.py</code> on this laptop, then launch the Android USB Bridge app.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Main control card */}
      <div className="border border-[#1A3C2B]/20 p-8 flex flex-col gap-6 bg-white/50 backdrop-blur">
        <div className="flex justify-between items-center border-b border-[#1A3C2B]/10 pb-4">
          <div className="font-mono text-[12px] uppercase tracking-widest opacity-70">
            {audioSource === 'laptop' ? 'Microphone Status' :
             audioSource === 'phone-wifi' ? 'Phone Wi-Fi Status' :
             'USB Bridge Status'}
          </div>
          <div className={`font-mono text-[12px] uppercase font-bold tracking-widest ${
            liveState === 'WARNING' || liveState === 'ERROR' ? 'text-[#FF8C69]' :
            (liveState === 'RECORDING' || liveState === 'ANALYZING') ? 'text-[#3E7D5C]' :
            'text-[#1A3C2B]'}`}>
            {getStatusDisplay()}
          </div>
        </div>

        {/* Waveform — only for laptop mic */}
        {audioSource === 'laptop' && (
          <div
            className={`relative overflow-hidden transition-all duration-500 ${isActive ? 'h-[140px] opacity-100' : 'h-[60px] opacity-40'}`}
            style={{
              background: isActive ? 'linear-gradient(180deg, rgba(26,60,43,0.06) 0%, rgba(26,60,43,0.01) 100%)' : 'transparent',
              borderRadius: 6,
              border: isActive ? '1px solid rgba(62,125,92,0.25)' : '1px solid rgba(26,60,43,0.08)',
            }}
          >
            {isActive && (
              <div className="absolute top-2 left-3 flex items-center gap-2 z-10">
                <div className="w-2.5 h-2.5 rounded-full bg-[#3E7D5C]" style={{ animation: 'pulse-dot 1.2s ease-in-out infinite' }} />
                <span className="font-mono text-[10px] uppercase font-bold tracking-widest text-[#3E7D5C]">LIVE MICROPHONE STREAM</span>
              </div>
            )}
            <canvas ref={canvasRef} className="w-full h-full" style={{ display: 'block' }} />
          </div>
        )}

        {/* Phone Wi-Fi live result */}
        {audioSource === 'phone-wifi' && isActive && phoneResult && (
          <div className="border border-[#1A3C2B]/15 p-4 bg-[#1A3C2B]/5 flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider opacity-55">Latest Phone Analysis</span>
            <div className="flex justify-between items-center">
              <span className={`font-mono text-[14px] font-bold uppercase 
                ${phoneResult.classification === 'likely_ai_generated' ? 'text-[#FF8C69]' :
                  phoneResult.classification === 'suspicious' ? 'text-[#D4A017]' : 'text-[#3E7D5C]'}`}>
                {phoneResult.classification === 'likely_ai_generated' ? 'AI Generated' :
                 phoneResult.classification === 'suspicious' ? 'Suspicious' : 'Human Speech'}
              </span>
              <span className="font-grotesk text-[24px] font-bold text-[#1A3C2B]">
                {phoneResult.confidence?.toFixed(1)}%
              </span>
            </div>
            <span className="font-mono text-[10px] opacity-55">
              Windows: {phoneResult.windows_speech}/{phoneResult.windows_analyzed} speech
            </span>
          </div>
        )}

        {/* Progress bar */}
        {isActive && audioSource === 'laptop' && (
          <div className="flex flex-col gap-2 p-4 border border-[#1A3C2B]/15 bg-[#1A3C2B]/5 rounded">
            <div className="flex justify-between items-center font-mono text-[12px]">
              <span className="opacity-80 font-bold uppercase">
                {liveState === 'ANALYZING' ? <span className="text-[#FF8C69] animate-pulse">● ANALYZING WITH PELLAV2...</span> : '● CAPTURING 10-SECOND AUDIO SEGMENT'}
              </span>
              <span className="font-bold text-[#1A3C2B]">
                {liveState === 'ANALYZING' ? '10.0s / 10.0s (100%)' : `${segmentProgress.toFixed(1)}s / 10.0s (${Math.round(progressPercent)}%)`}
              </span>
            </div>
            <div className="w-full h-[8px] bg-[#1A3C2B]/10 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${liveState === 'ANALYZING' ? 'bg-[#FF8C69] animate-pulse' : 'bg-[#1A3C2B]'}`}
                style={{ width: liveState === 'ANALYZING' ? '100%' : `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-4 bg-[#FF8C69]/10 text-[#1A3C2B] font-sans text-[14px]">{errorMsg}</div>
        )}

        <div className="flex justify-center py-2">
          {liveState === 'READY' || liveState === 'ERROR' || liveState === 'STOPPED' ? (
            <button
              onClick={startProtection}
              className="bg-[#1A3C2B] text-[#FFF6E5] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors"
            >
              [ START LIVE PROTECTION ]
            </button>
          ) : (
            <button
              onClick={stopProtection}
              className="bg-transparent border border-[#1A3C2B] text-[#1A3C2B] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#1A3C2B]/5 transition-colors"
            >
              [ STOP ]
            </button>
          )}
        </div>
      </div>

      {liveState === 'WARNING' && (
        <div data-live-warning className="border border-[#FF8C69] bg-[#FF8C69]/5 p-6 flex flex-col gap-4" style={{ animation: 'pulse-warning 2s ease-in-out infinite' }}>
          <h3 className="font-grotesk text-[20px] font-bold text-[#1A3C2B]">⚠ POTENTIAL VOICE-CLONING IMPERSONATION</h3>
          <p className="font-sans text-[14px]">This audio segment shows characteristics associated with AI-generated or manipulated speech.</p>
          <ul className="list-disc ml-4 font-sans text-[14px] opacity-80 flex flex-col gap-1">
            <li>Do not send money.</li>
            <li>Do not share OTPs or passwords.</li>
            <li>Do not share confidential information.</li>
            <li>Verify the caller independently before acting.</li>
          </ul>
        </div>
      )}

      {timeline.length > 0 && (() => {
        const overallAvgFake = timeline.reduce((sum, item) => sum + item.p_fake, 0) / timeline.length;
        const peakFake = Math.max(...timeline.map(item => item.p_fake));
        const isAiGen = fullAnalysisResult ? fullAnalysisResult.classification === 'likely_ai_generated' : overallAvgFake >= 0.70;
        const isSusp = fullAnalysisResult ? fullAnalysisResult.classification === 'suspicious' : overallAvgFake >= 0.50;
        const overallVerdict = isAiGen ? 'LIKELY AI-GENERATED' : isSusp ? 'SUSPICIOUS VOICE' : 'LIKELY REAL VOICE';
        const statusColor = isAiGen ? 'text-[#FF8C69] border-[#FF8C69] bg-[#FF8C69]/10' :
                            isSusp  ? 'text-[#D4A017] border-[#D4A017] bg-[#D4A017]/10' :
                            'text-[#3E7D5C] border-[#3E7D5C] bg-[#3E7D5C]/10';
        const displayFakePct = fullAnalysisResult
          ? (fullAnalysisResult.p_fake * 100).toFixed(1)
          : (overallAvgFake * 100).toFixed(1);

        return (
          <div className="mt-8 border-2 border-[#1A3C2B] bg-white p-6 shadow-sm flex flex-col gap-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-[#1A3C2B]/15 pb-4 gap-3">
              <div>
                <h3 className="font-mono text-[11px] uppercase tracking-widest opacity-60">Full Recording Final Answer & Playback</h3>
                <div className="font-grotesk text-[24px] font-bold text-[#1A3C2B] mt-1">COMPLETE LIVE SESSION ANALYSIS</div>
              </div>
              {isAnalyzingFull ? (
                <div className="px-4 py-2 border border-[#1A3C2B] bg-[#1A3C2B]/5 font-mono text-[12px] font-bold uppercase tracking-wider animate-pulse">● ANALYZING FULL RECORDING...</div>
              ) : (
                <div className={`px-4 py-2 border font-mono text-[13px] font-bold uppercase tracking-wider ${statusColor}`}>VERDICT: {overallVerdict}</div>
              )}
            </div>

            {fullAudioUrl && (
              <div className="flex flex-col gap-2 p-4 border border-[#1A3C2B]/20 bg-[#1A3C2B]/5 rounded">
                <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider text-[#1A3C2B] font-bold">
                  <span>● FULL SESSION RECORDING PLAYBACK</span>
                  <span>{timeline.length * 10}s TOTAL</span>
                </div>
                <audio controls src={fullAudioUrl} className="w-full h-[40px] outline-none mt-1" />
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-[#F5F2EB] p-4 border border-[#1A3C2B]/10">
              {[
                ['FULL RECORDING AI RISK', `${displayFakePct}%`],
                ['PEAK SEGMENT RISK', `${(peakFake * 100).toFixed(1)}%`],
                ['SEGMENTS ANALYZED', `${timeline.length}`],
                ['AI DETECTION MODEL', 'Pellav2 Wav2Vec2'],
              ].map(([label, val]) => (
                <div key={label} className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase opacity-60">{label}</span>
                  <span className="font-grotesk text-[22px] font-bold text-[#1A3C2B]">{val}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center bg-[#1A3C2B]/5 p-4 border border-[#1A3C2B]/15 gap-3">
              <div className="flex flex-col">
                <span className="font-mono text-[11px] uppercase font-bold text-[#1A3C2B]">EXPORT FULL SESSION RECORDING</span>
                <span className="font-sans text-[13px] opacity-75">Save the entire live audio session as MP3.</span>
              </div>
              <button
                onClick={handleDownloadFullSessionMp3}
                disabled={isDownloadingFull}
                className="w-full md:w-auto bg-[#1A3C2B] text-[#FFF6E5] px-6 py-3 font-mono text-[12px] uppercase tracking-wider hover:bg-[#1A3C2B]/90 transition-colors disabled:opacity-50 font-bold whitespace-nowrap"
              >
                {isDownloadingFull ? '[ CONCATENATING... ]' : '[ DOWNLOAD FULL RECORDING (.MP3) ]'}
              </button>
            </div>
          </div>
        );
      })()}

      {timeline.length > 0 && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h4 className="font-mono text-[12px] uppercase tracking-widest opacity-60">Live Timeline Analysis (10s Segments)</h4>
            <span className="font-mono text-[10px] uppercase opacity-50">{timeline.length} Segments</span>
          </div>
          <div className="flex flex-col gap-3">
            {timeline.map((item, idx) => (
              <div key={item.id} className="flex flex-col md:flex-row justify-between items-center border border-[#1A3C2B]/15 p-5 bg-white/70 gap-4"
                style={{ animation: idx === 0 ? 'slide-in 0.4s ease-out' : 'none' }}>
                <div className="flex flex-col gap-1 w-full md:w-[22%]">
                  <span className="font-mono text-[12px] opacity-70">Segment {String(item.id).padStart(2, '0')}</span>
                  <span className="font-sans text-[14px] font-bold text-[#1A3C2B]">{item.time}</span>
                </div>
                <div className="flex flex-col gap-1 items-center w-full md:w-[36%]">
                  <span className="font-mono text-[10px] uppercase tracking-widest opacity-60">AI-GENERATED PROBABILITY</span>
                  <span className="font-grotesk text-[26px] font-bold text-[#1A3C2B]">{(item.p_fake * 100).toFixed(1)}%</span>
                </div>
                <div className="flex flex-col gap-1 items-center md:items-end w-full md:w-[22%]">
                  <span className={`font-sans text-[14px] font-bold uppercase ${
                    item.classification === 'likely_ai_generated' ? 'text-[#FF8C69]' :
                    item.classification === 'suspicious' ? 'text-[#D4A017]' : 'text-[#3E7D5C]'}`}>
                    {item.classification === 'likely_ai_generated' ? 'AI Generated' :
                     item.classification === 'suspicious' ? 'Suspicious' : 'Human Speech'}
                  </span>
                  <span className="font-mono text-[10px] uppercase opacity-70">RISK: {item.risk_level}</span>
                </div>
                <div className="flex items-center justify-end w-full md:w-[22%]">
                  <button
                    onClick={() => handleDownloadSegmentMp3(item)}
                    disabled={downloadingId === item.id}
                    className="bg-transparent border border-[#1A3C2B] text-[#1A3C2B] px-3 py-2 font-mono text-[11px] uppercase tracking-wider hover:bg-[#1A3C2B]/10 transition-colors disabled:opacity-50 font-bold"
                  >
                    {downloadingId === item.id ? '[ CONVERTING... ]' : '[ DOWNLOAD MP3 ]'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
