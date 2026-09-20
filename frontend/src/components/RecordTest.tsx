import React, { useState, useRef, useEffect } from 'react';
import { api, getWsUrl } from '../services/api';
import type { AnalysisResult, AudioSource, PhoneConnectionState } from '../types';
import { AudioSourceSelector } from './AudioSourceSelector';
import { PhoneConnectModal } from './PhoneConnectModal';

type RecordState =
  | 'IDLE' | 'REQUESTING_PERMISSION' | 'RECORDING' | 'RECORDED'
  | 'ANALYZING' | 'COMPLETE' | 'ERROR';

const MIN_DURATION_S = 2;
const MIN_BLOB_BYTES = 8000;

export const RecordTest: React.FC = () => {
  const [audioSource, setAudioSource] = useState<AudioSource>('laptop');
  const [phoneState, setPhoneState] = useState<PhoneConnectionState>('disconnected');
  const [showPhoneModal, setShowPhoneModal] = useState(false);

  // Phone telemetry state
  const [phoneTelemetry, setPhoneTelemetry] = useState({
    frames: 0,
    bytes: 0,
    level: 0,
    duration_s: 0,
    state: 'disconnected',
  });

  const [recordState, setRecordState] = useState<RecordState>('IDLE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [timerInSeconds, setTimerInSeconds] = useState(0);
  const [finalDuration, setFinalDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  // Level meter
  const [audioLevel, setAudioLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const intervalRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      stopLevelMeter();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl]);

  // Telemetry subscriber for Phone Wi-Fi
  useEffect(() => {
    if (audioSource !== 'phone-wifi') return;
    const wsUrl = getWsUrl('/ws/phone?role=laptop');
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'TELEMETRY') {
          setPhoneTelemetry({
            frames: data.frames || 0,
            bytes: data.bytes || 0,
            level: data.level || 0,
            duration_s: data.duration_s || 0,
            state: data.state || 'disconnected',
          });

          if (data.state === 'connected') setPhoneState('connected');
          else if (data.state === 'mic_ready') setPhoneState('mic_ready');
          else if (data.state === 'streaming') setPhoneState('streaming');
        }
      } catch { /* ignore */ }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, [audioSource]);

  const startLevelMeter = (stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      audioCtxRef.current = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        levelRafRef.current = requestAnimationFrame(tick);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setAudioLevel(Math.min(100, (avg / 128) * 160));
      };
      tick();
    } catch { /* ignore */ }
  };

  const stopLevelMeter = () => {
    if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = null; }
    if (audioCtxRef.current?.state !== 'closed') { audioCtxRef.current?.close(); audioCtxRef.current = null; }
    setAudioLevel(0);
  };

  const handleStartRecording = async () => {
    setRecordState('REQUESTING_PERMISSION');
    setErrorMsg(null);
    setAudioBlob(null);
    setAnalysisResult(null);
    setTimerInSeconds(0);
    setFinalDuration(0);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);

    if (audioSource === 'phone-wifi' && !['connected', 'mic_ready', 'streaming', 'stopped'].includes(phoneState)) {
      setShowPhoneModal(true);
      setRecordState('IDLE');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      startLevelMeter(stream);

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stopLevelMeter();
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setRecordState('RECORDED');
      };

      recorder.start();
      setRecordState('RECORDING');
      intervalRef.current = window.setInterval(() => setTimerInSeconds(s => s + 1), 1000);
    } catch {
      setRecordState('ERROR');
      setErrorMsg('Microphone permission was denied. Enable microphone access and try again.');
    }
  };

  const handleStopRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
      if (intervalRef.current) clearInterval(intervalRef.current);
      setFinalDuration(timerInSeconds);
    }
  };

  // Requirement 9: Fetch recorded phone audio from backend
  const handleFetchPhoneRecording = async () => {
    setRecordState('ANALYZING');
    setErrorMsg(null);
    try {
      const blob = await api.downloadLatestPhoneWav();
      setAudioBlob(blob);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(blob));
      setFinalDuration(phoneTelemetry.duration_s || 5);

      const res = await api.analyzePhoneRecording();
      setAnalysisResult(res);
      setRecordState('COMPLETE');
    } catch (err: any) {
      setRecordState('ERROR');
      setErrorMsg(err.message || 'Failed to fetch or analyze phone recording.');
    }
  };

  const canTest = audioBlob !== null && finalDuration >= MIN_DURATION_S && audioBlob.size >= MIN_BLOB_BYTES;

  const handleAnalyze = async () => {
    if (!audioBlob || !canTest) return;
    setRecordState('ANALYZING');
    setErrorMsg(null);

    const file = new File([audioBlob], 'voiceguard-recording.webm', { type: audioBlob.type });
    try {
      const res = await api.analyzeAudio(file);
      setAnalysisResult(res);
      setRecordState('COMPLETE');
    } catch (err: any) {
      setRecordState('ERROR');
      setErrorMsg(err.message || 'Analysis failed.');
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    a.download = `voiceguard-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.webm`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const formatTimer = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const getResultColor = (res: AnalysisResult) => {
    if (res.classification === 'insufficient') return 'text-[#1A3C2B] border-[#1A3C2B]/30 bg-[#1A3C2B]/5';
    if (res.classification === 'likely_ai_generated') return 'text-[#c2410c] border-[#FF8C69] bg-[#FF8C69]/15';
    if (res.classification === 'suspicious') return 'text-[#92400e] border-[#F4D35E] bg-[#F4D35E]/20';
    return 'text-[#15803d] border-[#22c55e]/50 bg-[#22c55e]/10';
  };

  const phoneOk = ['connected', 'mic_ready', 'streaming', 'stopped'].includes(phoneState);

  return (
    <div className="flex flex-col gap-8 w-full max-w-[800px] mx-auto p-0">
      {showPhoneModal && (
        <PhoneConnectModal
          onClose={() => setShowPhoneModal(false)}
          onStateChange={(s) => setPhoneState(s)}
        />
      )}

      <div className="flex flex-col gap-4 text-center">
        <h2 className="font-grotesk text-[32px] md:text-[36px] font-bold text-[#1A3C2B]">RECORD & TEST</h2>
        <p className="font-sans text-[14px] opacity-70 max-w-[480px] mx-auto">
          Record a complete voice sample (laptop mic or phone Wi-Fi stream) and evaluate it through the VoiceGuard detector.
        </p>
      </div>

      {/* ── Audio Source Selector ────────────────────────────────────────── */}
      <div className="border border-[#1A3C2B]/20 p-6 bg-white/50 backdrop-blur">
        <AudioSourceSelector
          value={audioSource}
          onChange={(s) => { setAudioSource(s); setRecordState('IDLE'); setErrorMsg(null); }}
          disabled={recordState === 'RECORDING'}
        />

        {audioSource === 'phone-wifi' && (
          <div className="mt-4 flex flex-col gap-3 border-t border-[#1A3C2B]/10 pt-4">
            <div className="flex items-center justify-between">
              <span className={`font-mono text-[12px] font-bold ${phoneOk ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
                {phoneOk ? '🟢 Phone Connected' : '🔴 Phone Not Connected'}
              </span>
              <button
                onClick={() => setShowPhoneModal(true)}
                className="bg-[#1A3C2B] text-[#FFF6E5] px-5 py-2 font-mono text-[11px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors"
              >
                [ CONNECT PHONE ]
              </button>
            </div>

            {/* Requirement 9: Live telemetry & Phone recording testing */}
            <div className="bg-[#1A3C2B]/5 p-3 font-mono text-[11px] flex flex-col gap-2 border border-[#1A3C2B]/10">
              <div className="flex justify-between">
                <span>PHONE STREAM: <strong className="uppercase text-[#1A3C2B]">{phoneTelemetry.state}</strong></span>
                <span>FRAMES: <strong>{phoneTelemetry.frames.toLocaleString()}</strong></span>
                <span>BYTES: <strong>{(phoneTelemetry.bytes / 1024).toFixed(0)} KB</strong></span>
              </div>
              {phoneTelemetry.bytes > 0 && (
                <button
                  onClick={handleFetchPhoneRecording}
                  className="mt-1 bg-[#1A3C2B] text-[#FFF6E5] px-4 py-2 text-[11px] font-bold uppercase tracking-widest hover:bg-[#1A3C2B]/80"
                >
                  [ TEST PHONE RECORDED AUDIO ]
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Recording Controls ───────────────────────────────────────────── */}
      <div className="border border-[#1A3C2B]/20 p-8 flex flex-col gap-6 bg-white/50 backdrop-blur">

        {(recordState === 'IDLE' || recordState === 'REQUESTING_PERMISSION') && audioSource === 'laptop' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <button
              onClick={handleStartRecording}
              disabled={recordState === 'REQUESTING_PERMISSION'}
              className="bg-[#1A3C2B] text-[#FFF6E5] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors disabled:opacity-50"
            >
              {recordState === 'REQUESTING_PERMISSION' ? '[ REQUESTING MIC... ]' : '[ START RECORDING ]'}
            </button>
          </div>
        )}

        {recordState === 'RECORDING' && (
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="flex flex-col items-center gap-2">
              <div className="font-mono text-[13px] uppercase tracking-widest text-[#FF8C69] font-bold flex items-center gap-2">
                <div className="w-3 h-3 bg-[#FF8C69] rounded-full animate-ping" />
                ● RECORDING
              </div>
              <div className="font-grotesk text-[52px] font-bold text-[#1A3C2B] leading-none tabular-nums">
                {formatTimer(timerInSeconds)}
              </div>
            </div>

            <div className="w-full max-w-[360px] flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-50">Audio Level</span>
              <div className="h-2.5 bg-[#1A3C2B]/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all bg-[#1A3C2B]"
                  style={{ width: `${audioLevel}%`, transition: 'width 80ms linear' }}
                />
              </div>
            </div>

            <button
              onClick={handleStopRecording}
              className="bg-transparent border border-[#FF8C69] text-[#FF8C69] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#FF8C69]/10 transition-colors"
            >
              [ STOP RECORDING ]
            </button>
          </div>
        )}

        {(recordState === 'RECORDED' || recordState === 'ANALYZING' || recordState === 'COMPLETE') && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-[#1A3C2B]/10 pb-4">
              <div>
                <div className="font-mono text-[13px] uppercase tracking-widest text-[#3E7D5C] font-bold">Recording Ready</div>
                <div className="font-sans text-[13px] opacity-70 mt-0.5">
                  Duration: <strong>{finalDuration}s</strong>
                  {audioBlob && <> · Size: <strong>{(audioBlob.size / 1024).toFixed(0)} KB</strong></>}
                </div>
              </div>
              <button
                onClick={() => { setRecordState('IDLE'); setAudioBlob(null); setAnalysisResult(null); }}
                className="font-mono text-[11px] opacity-50 hover:opacity-80 transition-opacity border border-[#1A3C2B]/20 px-3 py-1.5"
              >
                [ NEW RECORDING ]
              </button>
            </div>

            {audioUrl && (
              <audio controls src={audioUrl} className="w-full h-[40px] outline-none" />
            )}

            {!canTest && recordState === 'RECORDED' && (
              <div className="p-3 bg-[#F4D35E]/20 border border-[#F4D35E]/50 font-sans text-[12px] text-[#92400e]">
                ⚠ Recording too short or too small to analyze reliably (min {MIN_DURATION_S}s, {MIN_BLOB_BYTES / 1000}KB).
              </div>
            )}

            {recordState === 'RECORDED' && (
              <div className="flex flex-wrap gap-3 justify-center">
                <button
                  onClick={handleDownload}
                  className="bg-transparent border border-[#1A3C2B] text-[#1A3C2B] px-6 py-3 font-mono text-[12px] uppercase tracking-widest hover:bg-[#1A3C2B]/5 transition-colors"
                >
                  [ DOWNLOAD RECORDING ]
                </button>
                <button
                  onClick={handleAnalyze}
                  disabled={!canTest}
                  className="bg-[#1A3C2B] text-[#FFF6E5] px-6 py-3 font-mono text-[12px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors disabled:opacity-40"
                >
                  [ TEST AUDIO ]
                </button>
              </div>
            )}

            {recordState === 'ANALYZING' && (
              <div className="flex flex-col items-center gap-4 py-6 animate-pulse">
                <span className="font-mono text-[12px] uppercase tracking-widest opacity-60">Analyzing Recording...</span>
                <span className="font-mono text-[18px] uppercase tracking-widest text-[#1A3C2B]">PELLAV2</span>
              </div>
            )}
          </div>
        )}

        {recordState === 'ERROR' && (
          <div className="p-4 bg-[#FF8C69]/10 text-[#1A3C2B] font-sans text-[14px]">
            {errorMsg}
            <div className="mt-4 flex justify-center">
              <button onClick={() => setRecordState('IDLE')} className="border border-[#1A3C2B] px-4 py-2 font-mono text-[12px]">
                [ RESET ]
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Result Display ───────────────────────────────────────────────── */}
      {recordState === 'COMPLETE' && analysisResult && (() => {
        const res = analysisResult;
        const isInsuf = res.classification === 'insufficient';
        const isAI    = res.classification === 'likely_ai_generated';
        const isSusp  = res.classification === 'suspicious';

        return (
          <div className="border border-[#1A3C2B]/20 p-8 flex flex-col gap-6 bg-white/50 backdrop-blur">
            <h3 className="font-mono text-[13px] uppercase tracking-widest border-b border-[#1A3C2B]/10 pb-4 text-[#1A3C2B]">
              VoiceGuard Analysis Result
            </h3>

            {isInsuf ? (
              <div className="flex flex-col items-center gap-4 py-6 text-center">
                <div className="font-grotesk text-[24px] font-bold text-[#1A3C2B]">INSUFFICIENT AUDIO QUALITY</div>
                <p className="font-sans text-[14px] opacity-70 max-w-[360px]">
                  Not enough usable speech found in this recording. Please record again with clearer speech.
                </p>
                <div className={`px-6 py-2 border font-mono text-[12px] font-bold uppercase tracking-widest ${getResultColor(res)}`}>
                  {res.label}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-center py-4">
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest opacity-55">Classification</span>
                    <div className={`px-5 py-2.5 border font-mono text-[13px] font-bold uppercase tracking-widest ${getResultColor(res)}`}>
                      {res.label}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-widest opacity-55">Confidence</span>
                    <span className="font-grotesk text-[52px] font-bold text-[#1A3C2B] leading-none tabular-nums">
                      {res.confidence !== undefined ? `${res.confidence.toFixed(1)}%` : `${((1 - res.p_fake) * 100).toFixed(1)}%`}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-[#1A3C2B]/10 pt-6">
                  {[
                    ['Windows Analyzed', `${res.windows_analyzed ?? 'N/A'}`],
                    ['Speech Windows',   `${res.windows_speech ?? 'N/A'}`],
                    ['Duration',         res.duration ? `${res.duration.toFixed(1)}s` : 'N/A'],
                    ['Audio Quality',    res.audio_quality ? res.audio_quality.toUpperCase() : 'N/A'],
                  ].map(([label, val]) => (
                    <div key={label} className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] uppercase opacity-50">{label}</span>
                      <span className="font-sans text-[15px] font-bold text-[#1A3C2B]">{val}</span>
                    </div>
                  ))}
                </div>

                {isAI && (
                  <div className="p-4 bg-[#FF8C69]/10 border border-[#FF8C69]/30 font-sans text-[13px]">
                    <strong>⚠ This recording shows characteristics associated with AI-generated speech.</strong>
                  </div>
                )}
                {isSusp && (
                  <div className="p-4 bg-[#F4D35E]/20 border border-[#F4D35E]/40 font-sans text-[13px]">
                    <strong>? Borderline result.</strong> Consider re-recording in a quieter environment.
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-center mt-2">
              <button
                onClick={() => { setRecordState('IDLE'); setAnalysisResult(null); }}
                className="bg-transparent border border-[#1A3C2B] text-[#1A3C2B] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#1A3C2B]/5 transition-colors"
              >
                [ TEST ANOTHER SAMPLE ]
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
