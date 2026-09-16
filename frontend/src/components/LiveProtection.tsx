import React, { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { convertBlobToWav, triggerBlobDownload } from '../utils/wavExporter';
import type { LiveAnalysisResult, AnalysisResult } from '../types';

type LiveState = 'READY' | 'REQUESTING_PERMISSION' | 'RECORDING' | 'ANALYZING' | 'WARNING' | 'STOPPED' | 'ERROR';

interface TimelineItem extends LiveAnalysisResult {
  id: number;
  time: string;
  blob: Blob;
  isDownloadingWav?: boolean;
}

export const LiveProtection: React.FC = () => {
  const [liveState, setLiveState] = useState<LiveState>('READY');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [segmentProgress, setSegmentProgress] = useState<number>(0.0);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [isDownloadingFull, setIsDownloadingFull] = useState<boolean>(false);
  
  // Full session recorder & analysis state
  const [fullAudioUrl, setFullAudioUrl] = useState<string | null>(null);
  const [fullAnalysisResult, setFullAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzingFull, setIsAnalyzingFull] = useState<boolean>(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimerRef = useRef<number | null>(null);
  const progressIntervalRef = useRef<number | null>(null);
  const segmentCounter = useRef<number>(1);
  const isStoppingRef = useRef<boolean>(false);
  const elapsedSecondsRef = useRef<number>(0);
  const allChunksRef = useRef<BlobPart[]>([]);

  // Waveform refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopWaveform();
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (fullAudioUrl) URL.revokeObjectURL(fullAudioUrl);
    };
  }, [fullAudioUrl]);

  const startWaveform = useCallback((stream: MediaStream) => {
    try {
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128; // 64 bins for high-motion spectrum bars
      analyser.smoothingTimeConstant = 0.75;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      sourceRef.current = source;

      drawWaveform();
    } catch (err) {
      console.error('Failed to create audio context for waveform:', err);
    }
  }, []);

  const stopWaveform = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
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

      const w = displayW;
      const h = displayH;

      ctx.clearRect(0, 0, w, h);

      const isWarning = document.querySelector('[data-live-warning]') !== null;
      const mainColor = isWarning ? '#FF8C69' : '#3E7D5C';
      const glowColor = isWarning ? 'rgba(255, 140, 105, 0.4)' : 'rgba(62, 125, 92, 0.4)';

      // 1. Draw Hyper-Motion Frequency Spectrum Bars
      const numBars = 36;
      const barWidth = (w / numBars) - 3;
      let barX = 2;

      for (let i = 0; i < numBars; i++) {
        const dataIdx = Math.floor((i / numBars) * bufferLength);
        const amplitude = freqData[dataIdx] / 255.0; // 0.0 -> 1.0
        const barHeight = Math.max(4, amplitude * (h * 0.75));

        const barY = h - barHeight - 4;

        ctx.fillStyle = mainColor;
        ctx.shadowBlur = 6;
        ctx.shadowColor = glowColor;

        // Draw rounded top bar
        ctx.beginPath();
        ctx.roundRect(barX, barY, barWidth, barHeight, [3, 3, 0, 0]);
        ctx.fill();

        barX += barWidth + 3;
      }

      ctx.shadowBlur = 0;

      // 2. Draw Overlaid Central Waveform Line
      ctx.lineWidth = 2;
      ctx.strokeStyle = isWarning ? 'rgba(255, 140, 105, 0.8)' : 'rgba(158, 255, 191, 0.9)';
      ctx.beginPath();

      const sliceWidth = w / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = timeData[i] / 128.0;
        const y = (v * h) / 2;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);

        x += sliceWidth;
      }

      ctx.lineTo(w, h / 2);
      ctx.stroke();
    };

    draw();
  };

  const startProgressTimer = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setSegmentProgress(0.0);

    const startTime = Date.now();
    progressIntervalRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed >= 10.0) {
        setSegmentProgress(10.0);
      } else {
        setSegmentProgress(elapsed);
      }
    }, 100);
  };

  const stopProgressTimer = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const startProtection = async () => {
    setLiveState('REQUESTING_PERMISSION');
    setErrorMsg(null);
    setTimeline([]);
    segmentCounter.current = 1;
    isStoppingRef.current = false;
    elapsedSecondsRef.current = 0;
    allChunksRef.current = [];

    if (fullAudioUrl) URL.revokeObjectURL(fullAudioUrl);
    setFullAudioUrl(null);
    setFullAnalysisResult(null);
    setIsAnalyzingFull(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      streamRef.current = stream;
      startWaveform(stream);
      startRecordingLoop(stream);
    } catch (err: any) {
      setLiveState('ERROR');
      setErrorMsg('Microphone permission was denied. Enable microphone access and try again.');
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
    
    recorder.ondataavailable = (e) => {
       if (e.data.size > 0) {
          localChunks.push(e.data);
          allChunksRef.current.push(e.data);
       }
    };
    
    recorder.onstop = async () => {
       stopProgressTimer();
       
       if (localChunks.length > 0) {
          const audioBlob = new Blob(localChunks, { type: 'audio/webm' });
          // Process if chunk has adequate data (>10KB) or full 10s window completed
          if (audioBlob.size >= 10000 || !isStoppingRef.current) {
             const currentId = segmentCounter.current;
             segmentCounter.current++;
             processSegment(audioBlob, currentId, windowStart, windowEnd);
          }
       }
       
       if (!isStoppingRef.current) {
         elapsedSecondsRef.current += 10;
         startRecordingLoop(stream);
       }
    };
    
    recorder.start();
    
    chunkTimerRef.current = window.setTimeout(() => {
       if (recorder.state === 'recording') {
          recorder.stop();
       }
    }, 10000);
  };
  
  const processSegment = async (blob: Blob, segmentId: number, windowStart: number, windowEnd: number) => {
     setLiveState(prev => prev === 'RECORDING' ? 'ANALYZING' : prev);
     
     try {
       const result = await api.analyzeLiveAudio(blob, windowStart, windowEnd);
       
       const formatTime = (secs: number) => {
           const mins = Math.floor(secs / 60).toString().padStart(2, '0');
           const s = (secs % 60).toString().padStart(2, '0');
           return `${mins}:${s}`;
       };
       
       const timeStr = `${formatTime(result.window_start)}–${formatTime(result.window_end)}`;
       
       setTimeline(prev => {
          const filtered = prev.filter(item => item.id !== segmentId);
          const newItem: TimelineItem = { ...result, id: segmentId, time: timeStr, blob };
          const updated = [...filtered, newItem];
          return updated.sort((a, b) => b.id - a.id);
       });
       
       setLiveState(() => {
         if (isStoppingRef.current) return 'STOPPED';
         if (result.risk_level === 'high') return 'WARNING';
         return 'RECORDING';
       });
       
     } catch(e: any) {
       console.error("Segment analysis error:", e);
     }
  };
  
  const analyzeFullSession = async (blob: Blob) => {
     setIsAnalyzingFull(true);
     try {
       const file = new File([blob], 'voiceguard-live-full-session.webm', { type: blob.type || 'audio/webm' });
       const result = await api.analyzeAudio(file);
       setFullAnalysisResult(result);
     } catch (err: any) {
       console.error("Full session audio analysis error:", err);
     } finally {
       setIsAnalyzingFull(false);
     }
  };

  const stopProtection = () => {
    isStoppingRef.current = true;
    setLiveState('STOPPED');
    stopProgressTimer();
    
    if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
    
    if (recorderRef.current && recorderRef.current.state === 'recording') {
       recorderRef.current.stop();
    }
    
    if (streamRef.current) {
       streamRef.current.getTracks().forEach(t => t.stop());
    }

    stopWaveform();

    // Stitch all accumulated audio chunks for full session recording and analyze
    setTimeout(() => {
      if (allChunksRef.current.length > 0) {
        const fullBlob = new Blob(allChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(fullBlob);
        setFullAudioUrl(url);
        analyzeFullSession(fullBlob);
      }
    }, 400);
  };

  const handleDownloadSegmentMp3 = async (item: TimelineItem) => {
    setDownloadingId(item.id);
    try {
      const mp3Blob = await api.downloadLiveMp3(item.blob);
      const filename = `voiceguard-segment-${item.id.toString().padStart(2, '0')}-${item.classification}.mp3`;
      triggerBlobDownload(mp3Blob, filename);
    } catch (err) {
      console.error('Failed to export MP3 via backend, falling back to WAV:', err);
      try {
        const wavBlob = await convertBlobToWav(item.blob);
        const filename = `voiceguard-segment-${item.id.toString().padStart(2, '0')}-${item.classification}.wav`;
        triggerBlobDownload(wavBlob, filename);
      } catch (wavErr) {
        alert('Could not download audio file.');
      }
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadFullSessionMp3 = async () => {
    if (timeline.length === 0) return;
    setIsDownloadingFull(true);
    try {
      const sorted = [...timeline].sort((a, b) => a.id - b.id);
      const blobs = sorted.map(item => item.blob);
      const fullMp3Blob = await api.downloadFullLiveMp3(blobs);
      const filename = `voiceguard-full-session-recording-${timeline.length}segments.mp3`;
      triggerBlobDownload(fullMp3Blob, filename);
    } catch (err) {
      console.error('Failed to download full session MP3:', err);
      alert('Could not generate full session MP3 recording.');
    } finally {
      setIsDownloadingFull(false);
    }
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
      default: return '';
    }
  };

  const isActive = liveState === 'RECORDING' || liveState === 'ANALYZING' || liveState === 'WARNING';
  const progressPercent = Math.min(100, Math.max(0, (segmentProgress / 10.0) * 100));

  return (
    <div className="flex flex-col gap-8 w-full max-w-[800px] mx-auto p-0">
      <div className="flex flex-col gap-4 text-center">
         <h2 className="font-grotesk text-[32px] md:text-[36px] font-bold text-[#1A3C2B]">LIVE PROTECTION</h2>
         <p className="font-sans text-[14px] opacity-70 max-w-[480px] mx-auto">
            Microphone audio is captured in real-time 10-second windows and analyzed by VoiceGuard.
            <br />
            VoiceGuard detection is probabilistic and powered by Pellav2 Wav2Vec2 hidden states.
         </p>
      </div>

      <div className="border border-[#1A3C2B]/20 p-8 flex flex-col gap-6 bg-white/50 backdrop-blur">
        <div className="flex justify-between items-center border-b border-[#1A3C2B]/10 pb-4">
           <div className="font-mono text-[12px] uppercase tracking-widest opacity-70">
              Microphone status
           </div>
           <div className={`font-mono text-[12px] uppercase font-bold tracking-widest ${liveState === 'WARNING' || liveState === 'ERROR' ? 'text-[#FF8C69]' : (liveState === 'RECORDING' || liveState === 'ANALYZING' ? 'text-[#3E7D5C]' : 'text-[#1A3C2B]')}`}>
              {getStatusDisplay()}
           </div>
        </div>

        {/* ── DUAL HIGH-MOTION WAVEFORM VISUALIZER ── */}
        <div 
          className={`relative overflow-hidden transition-all duration-500 ${isActive ? 'h-[140px] opacity-100' : 'h-[60px] opacity-40'}`}
          style={{
            background: isActive 
              ? 'linear-gradient(180deg, rgba(26, 60, 43, 0.06) 0%, rgba(26, 60, 43, 0.01) 100%)'
              : 'transparent',
            borderRadius: '6px',
            border: isActive ? '1px solid rgba(62, 125, 92, 0.25)' : '1px solid rgba(26, 60, 43, 0.08)',
          }}
        >
          {isActive && (
            <div className="absolute top-2 left-3 flex items-center gap-2 z-10">
              <div 
                className="w-2.5 h-2.5 rounded-full bg-[#3E7D5C]"
                style={{ animation: 'pulse-dot 1.2s ease-in-out infinite' }}
              />
              <span className="font-mono text-[10px] uppercase font-bold tracking-widest text-[#3E7D5C]">
                LIVE MICROPHONE STREAM
              </span>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={{ display: 'block' }}
          />
        </div>

        {/* ── 10-SECOND REAL-TIME COLLECTION PROGRESS BAR ── */}
        {isActive && (
          <div className="flex flex-col gap-2 p-4 border border-[#1A3C2B]/15 bg-[#1A3C2B]/5 rounded">
             <div className="flex justify-between items-center font-mono text-[12px]">
                <span className="opacity-80 font-bold uppercase flex items-center gap-2">
                   {liveState === 'ANALYZING' ? (
                      <span className="text-[#FF8C69] animate-pulse">● ANALYZING WITH PELLAV2 AI MODEL...</span>
                   ) : (
                      <span>● CAPTURING 10-SECOND AUDIO SEGMENT</span>
                   )}
                </span>
                <span className="font-bold text-[#1A3C2B]">
                   {liveState === 'ANALYZING' ? '10.0s / 10.0s (100%)' : `${segmentProgress.toFixed(1)}s / 10.0s (${Math.round(progressPercent)}%)`}
                </span>
             </div>
             
             {/* Visual Progress Line */}
             <div className="w-full h-[8px] bg-[#1A3C2B]/10 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-100 ${liveState === 'ANALYZING' ? 'bg-[#FF8C69] animate-pulse' : 'bg-[#1A3C2B]'}`}
                  style={{ width: liveState === 'ANALYZING' ? '100%' : `${progressPercent}%` }}
                />
             </div>
          </div>
        )}

        {errorMsg && (
           <div className="p-4 bg-[#FF8C69]/10 text-[#1A3C2B] font-sans text-[14px]">
              {errorMsg}
           </div>
        )}

        <div className="flex justify-center py-2">
           {liveState === 'READY' || liveState === 'ERROR' || liveState === 'STOPPED' ? (
              <button 
                onClick={startProtection}
                className="bg-[#1A3C2B] text-[#FFF6E5] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors">
                [ START LIVE PROTECTION ]
              </button>
           ) : (
              <button 
                onClick={stopProtection}
                className="bg-transparent border border-[#1A3C2B] text-[#1A3C2B] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#1A3C2B]/5 transition-colors">
                [ STOP ]
              </button>
           )}
        </div>
      </div>

      {liveState === 'WARNING' && (
        <div data-live-warning className="border border-[#FF8C69] bg-[#FF8C69]/5 p-6 flex flex-col gap-4" style={{ animation: 'pulse-warning 2s ease-in-out infinite' }}>
           <h3 className="font-grotesk text-[20px] font-bold text-[#1A3C2B]">⚠ POTENTIAL VOICE-CLONING IMPERSONATION</h3>
           <p className="font-sans text-[14px]">This audio segment shows characteristics associated with AI-generated or manipulated speech.</p>
           <p className="font-sans text-[14px] font-bold mt-2">Verify the caller independently before sharing sensitive information.</p>
           <ul className="list-disc ml-4 font-sans text-[14px] opacity-80 flex flex-col gap-1">
             <li>Do not send money.</li>
             <li>Do not share OTPs.</li>
             <li>Do not share passwords.</li>
             <li>Do not share confidential information.</li>
             <li>Do not accuse the caller of being a scammer.</li>
           </ul>
        </div>
      )}

      {timeline.length > 0 && (() => {
        const overallAvgFake = timeline.reduce((sum, item) => sum + item.p_fake, 0) / timeline.length;
        const peakFake = Math.max(...timeline.map(item => item.p_fake));
        const hasHighRisk = timeline.some(item => item.classification === 'likely_ai_generated');
        const hasMediumRisk = timeline.some(item => item.classification === 'suspicious');

        // Determine verdict from full audio analysis if available, otherwise fall back to timeline average
        const isAiGen = fullAnalysisResult ? fullAnalysisResult.classification === 'likely_ai_generated' : (hasHighRisk || overallAvgFake >= 0.70);
        const isSusp = fullAnalysisResult ? fullAnalysisResult.classification === 'suspicious' : (hasMediumRisk || overallAvgFake >= 0.55);

        const overallVerdict = 
          isAiGen ? 'LIKELY AI-GENERATED' :
          isSusp ? 'SUSPICIOUS VOICE' :
          'LIKELY REAL VOICE';

        const statusColor = 
          isAiGen ? 'text-[#FF8C69] border-[#FF8C69] bg-[#FF8C69]/10' :
          isSusp ? 'text-[#D4A017] border-[#D4A017] bg-[#D4A017]/10' :
          'text-[#3E7D5C] border-[#3E7D5C] bg-[#3E7D5C]/10';

        const displayFakePct = fullAnalysisResult ? (fullAnalysisResult.p_fake * 100).toFixed(1) : (overallAvgFake * 100).toFixed(1);

        return (
          <div className="mt-8 border-2 border-[#1A3C2B] bg-white p-6 shadow-sm flex flex-col gap-6">
             <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-[#1A3C2B]/15 pb-4 gap-3">
                <div>
                   <h3 className="font-mono text-[11px] uppercase tracking-widest opacity-60">FULL RECORDING FINAL ANSWER & PLAYBACK RECORDER</h3>
                   <div className="font-grotesk text-[24px] font-bold text-[#1A3C2B] mt-1">
                      COMPLETE LIVE SESSION ANALYSIS
                   </div>
                </div>
                
                {isAnalyzingFull ? (
                  <div className="px-4 py-2 border border-[#1A3C2B] bg-[#1A3C2B]/5 font-mono text-[12px] font-bold uppercase tracking-wider text-[#1A3C2B] animate-pulse">
                     ● ANALYZING FULL RECORDING WITH PELLAV2...
                  </div>
                ) : (
                  <div className={`px-4 py-2 border font-mono text-[13px] font-bold uppercase tracking-wider ${statusColor}`}>
                     VERDICT: {overallVerdict}
                  </div>
                )}
             </div>

             {/* ── FULL AUDIO RECORDER PLAYBACK PLAYER ── */}
             {fullAudioUrl && (
                <div className="flex flex-col gap-2 p-4 border border-[#1A3C2B]/20 bg-[#1A3C2B]/5 rounded">
                   <div className="flex justify-between items-center font-mono text-[11px] uppercase tracking-wider text-[#1A3C2B] font-bold">
                      <span>● FULL SESSION RECORDING PLAYBACK</span>
                      <span>{timeline.length * 10}s TOTAL AUDIO</span>
                   </div>
                   <audio 
                      controls 
                      src={fullAudioUrl} 
                      className="w-full h-[40px] outline-none mt-1" 
                   />
                </div>
             )}

             {/* ── FULL AUDIO METRICS GRID ── */}
             <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-[#F5F2EB] p-4 border border-[#1A3C2B]/10">
                <div className="flex flex-col gap-1">
                   <span className="font-mono text-[10px] uppercase opacity-60">FULL RECORDING AI RISK</span>
                   <span className="font-grotesk text-[28px] font-bold text-[#1A3C2B]">{displayFakePct}%</span>
                </div>
                <div className="flex flex-col gap-1">
                   <span className="font-mono text-[10px] uppercase opacity-60">PEAK SEGMENT RISK</span>
                   <span className="font-grotesk text-[28px] font-bold text-[#1A3C2B]">{(peakFake * 100).toFixed(1)}%</span>
                </div>
                <div className="flex flex-col gap-1">
                   <span className="font-mono text-[10px] uppercase opacity-60">SEGMENTS ANALYZED</span>
                   <span className="font-grotesk text-[28px] font-bold text-[#1A3C2B]">{timeline.length} <span className="text-[14px] font-normal opacity-70">({timeline.length * 10}s total)</span></span>
                </div>
                <div className="flex flex-col gap-1">
                   <span className="font-mono text-[10px] uppercase opacity-60">AI DETECTION MODEL</span>
                   <span className="font-sans text-[14px] font-bold text-[#1A3C2B] mt-2">Pellav2 Wav2Vec2</span>
                </div>
             </div>

             {/* ── FULL SESSION RECORDING DOWNLOAD BUTTON ── */}
             <div className="flex flex-col md:flex-row justify-between items-center bg-[#1A3C2B]/5 p-4 border border-[#1A3C2B]/15 gap-3">
                <div className="flex flex-col gap-0.5">
                   <span className="font-mono text-[11px] uppercase font-bold text-[#1A3C2B]">EXPORT FULL SESSION RECORDING</span>
                   <span className="font-sans text-[13px] opacity-75">Save the entire recorded live audio session as an MP3 file.</span>
                </div>
                <button
                  onClick={handleDownloadFullSessionMp3}
                  disabled={isDownloadingFull}
                  className="w-full md:w-auto bg-[#1A3C2B] text-[#FFF6E5] px-6 py-3 font-mono text-[12px] uppercase tracking-wider hover:bg-[#1A3C2B]/90 transition-colors disabled:opacity-50 font-bold flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  {isDownloadingFull ? '[ CONCATENATING FULL MP3... ]' : '[ DOWNLOAD FULL RECORDING (.MP3) ]'}
                </button>
             </div>
          </div>
        );
      })()}

      {timeline.length > 0 && (
         <div className="mt-8 flex flex-col gap-4">
            <div className="flex justify-between items-center">
               <h4 className="font-mono text-[12px] uppercase tracking-widest opacity-60">Live Timeline Analysis (10s Segments)</h4>
               <span className="font-mono text-[10px] uppercase opacity-50">{timeline.length} Segments Analyzed</span>
            </div>

            <div className="flex flex-col gap-3">
               {timeline.map((item, idx) => (
                  <div key={item.id} className="flex flex-col md:flex-row justify-between items-center border border-[#1A3C2B]/15 p-5 bg-white/70 backdrop-blur transition-all gap-4" style={{ animation: idx === 0 ? 'slide-in 0.4s ease-out' : 'none' }}>
                     
                     <div className="flex flex-col gap-1 w-full md:w-[22%]">
                        <span className="font-mono text-[12px] opacity-70">Segment {item.id.toString().padStart(2, '0')}</span>
                        <span className="font-sans text-[14px] font-bold text-[#1A3C2B]">{item.time}</span>
                     </div>

                     <div className="flex flex-col gap-1 items-center w-full md:w-[36%]">
                        <span className="font-mono text-[10px] uppercase tracking-widest opacity-60">AI-GENERATED PROBABILITY</span>
                        <span className="font-grotesk text-[26px] font-bold text-[#1A3C2B]">{(item.p_fake * 100).toFixed(1)}%</span>
                     </div>

                     <div className="flex flex-col gap-1 items-center md:items-end w-full md:w-[22%]">
                        <span className={`font-sans text-[14px] font-bold uppercase text-right ${
                          item.classification === 'likely_ai_generated' ? 'text-[#FF8C69]' : 
                          item.classification === 'suspicious' ? 'text-[#D4A017]' : 'text-[#3E7D5C]'
                        }`}>
                           {item.classification === 'likely_ai_generated' ? 'Likely AI-Generated' : item.classification === 'suspicious' ? 'Suspicious' : 'Likely Real'}
                        </span>
                        <span className="font-mono text-[10px] uppercase opacity-70 text-right">RISK: {item.risk_level}</span>
                     </div>

                     {/* ── MP3 AUDIO DOWNLOAD BUTTON ── */}
                     <div className="flex items-center justify-end w-full md:w-[22%]">
                        <button
                          onClick={() => handleDownloadSegmentMp3(item)}
                          disabled={downloadingId === item.id}
                          className="bg-transparent border border-[#1A3C2B] text-[#1A3C2B] px-3 py-2 font-mono text-[11px] uppercase tracking-wider hover:bg-[#1A3C2B]/10 transition-colors disabled:opacity-50 flex items-center gap-1.5 font-bold"
                        >
                          {downloadingId === item.id ? '[ CONVERTING MP3... ]' : '[ DOWNLOAD MP3 ]'}
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
