import React, { useState, useRef, useEffect } from 'react';
import { api } from '../services/api';
import type { AnalysisResult } from '../types';

type RecordState = 'IDLE' | 'REQUESTING_PERMISSION' | 'RECORDING' | 'RECORDED' | 'PLAYING' | 'ANALYZING' | 'COMPLETE' | 'ERROR';

export const RecordTest: React.FC = () => {
  const [recordState, setRecordState] = useState<RecordState>('IDLE');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [timerInSeconds, setTimerInSeconds] = useState(0);
  const [finalDuration, setFinalDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const handleStartRecording = async () => {
    setRecordState('REQUESTING_PERMISSION');
    setErrorMsg(null);
    setAudioBlob(null);
    setAnalysisResult(null);
    setTimerInSeconds(0);
    setFinalDuration(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });
      streamRef.current = stream;
      
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorderRef.current = recorder;
      
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const fullBlob = new Blob(chunks, { type: 'audio/webm' });
        setAudioBlob(fullBlob);
        const url = URL.createObjectURL(fullBlob);
        setAudioUrl(url);
        
        // Stop the tracks completely
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        
        setRecordState('RECORDED');
      };

      recorder.start();
      setRecordState('RECORDING');

      intervalRef.current = window.setInterval(() => {
        setTimerInSeconds(prev => prev + 1);
      }, 1000);
      
    } catch (err: any) {
      setRecordState('ERROR');
      setErrorMsg('Microphone permission was denied. Enable microphone access and try again.');
    }
  };

  const handleStopRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
      if (intervalRef.current) clearInterval(intervalRef.current);
      setFinalDuration(timerInSeconds);
    }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    
    // YYYY-MM-DD-HH-MM-SS
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const filename = `voiceguard-recording-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.webm`;
    
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleAnalyze = async () => {
    if (!audioBlob) return;
    setRecordState('ANALYZING');
    setErrorMsg(null);
    
    const file = new File([audioBlob], 'voiceguard-recording.webm', { type: audioBlob.type });
    
    try {
      const res = await api.analyzeAudio(file);
      setAnalysisResult(res);
      setRecordState('COMPLETE');
    } catch(err: any) {
      setRecordState('ERROR');
      setErrorMsg(err.message || 'Analysis failed.');
    }
  };

  const formatTimer = (s: number) => {
    const mins = Math.floor(s / 60).toString().padStart(2, '0');
    const secs = (s % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <div className="flex flex-col gap-8 w-full max-w-[800px] mx-auto p-0">
      <div className="flex flex-col gap-4 text-center">
         <h2 className="font-grotesk text-[32px] md:text-[36px] font-bold text-[#1A3C2B]">RECORD & TEST</h2>
         <p className="font-sans text-[14px] opacity-70 max-w-[480px] mx-auto">
            Record a complete voice sample and analyze it with VoiceGuard. Your recording remains available in this session. Download it if you want to keep a local copy.
         </p>
      </div>

      <div className="border border-[#1A3C2B]/20 p-8 flex flex-col gap-6 bg-white/50 backdrop-blur">
        
        {recordState === 'IDLE' || recordState === 'REQUESTING_PERMISSION' ? (
           <div className="flex flex-col items-center gap-4 py-8">
              <button 
                onClick={handleStartRecording}
                disabled={recordState === 'REQUESTING_PERMISSION'}
                className="bg-[#1A3C2B] text-[#FFF6E5] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors disabled:opacity-50">
                {recordState === 'REQUESTING_PERMISSION' ? '[ CONNECTING... ]' : '[ START RECORDING ]'}
              </button>
           </div>
        ) : null}

        {recordState === 'RECORDING' && (
           <div className="flex flex-col items-center gap-6 py-8 animate-pulse-subtle">
              <div className="flex flex-col items-center gap-2">
                 <div className="font-mono text-[14px] uppercase tracking-widest text-[#FF8C69] font-bold flex items-center gap-2">
                    <div className="w-3 h-3 bg-[#FF8C69] rounded-full animate-ping"></div>
                    ● RECORDING
                 </div>
                 <div className="font-grotesk text-[36px] text-[#1A3C2B]">{formatTimer(timerInSeconds)}</div>
              </div>

              <button 
                onClick={handleStopRecording}
                className="bg-transparent border border-[#FF8C69] text-[#FF8C69] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#FF8C69]/10 transition-colors">
                [ STOP RECORDING ]
              </button>
           </div>
        )}

        {(recordState === 'RECORDED' || recordState === 'PLAYING' || recordState === 'ANALYZING' || recordState === 'COMPLETE') && (
           <div className="flex flex-col items-center gap-8 py-4">
              <div className="flex flex-col items-center gap-1">
                 <div className="font-mono text-[14px] uppercase tracking-widest text-[#3E7D5C] font-bold">RECORDING COMPLETE</div>
                 <div className="font-sans text-[14px] opacity-70">Duration: {finalDuration} seconds</div>
              </div>

              {audioUrl && (
                 <audio 
                    controls 
                    src={audioUrl} 
                    className="w-full max-w-[400px] h-[40px] outline-none" 
                    onPlay={() => setRecordState(prev => prev === 'RECORDED' ? 'PLAYING' : prev)}
                 />
              )}

              {recordState === 'RECORDED' || recordState === 'PLAYING' ? (
                <div className="flex flex-wrap justify-center gap-4">
                  <button 
                    onClick={handleDownload}
                    className="bg-transparent border border-[#1A3C2B] text-[#1A3C2B] px-6 py-3 font-mono text-[12px] uppercase tracking-widest hover:bg-[#1A3C2B]/5 transition-colors">
                    [ DOWNLOAD RECORDING ]
                  </button>
                  <button 
                    onClick={handleAnalyze}
                    className="bg-[#1A3C2B] text-[#FFF6E5] px-6 py-3 font-mono text-[12px] uppercase tracking-widest hover:bg-[#1A3C2B]/80 transition-colors">
                    [ ANALYZE RECORDING ]
                  </button>
                </div>
              ) : null}
              
              {recordState === 'ANALYZING' && (
                 <div className="flex flex-col items-center gap-4 py-8 animate-pulse">
                    <span className="font-mono text-[12px] uppercase tracking-widest opacity-60">ANALYZING COMPLETE RECORDING...</span>
                    <span className="font-mono text-[18px] uppercase tracking-widest text-[#1A3C2B]">PELLAV2</span>
                 </div>
              )}
           </div>
        )}

        {recordState === 'ERROR' && (
           <div className="p-4 bg-[#FF8C69]/10 text-[#1A3C2B] font-sans text-[14px]">
              {errorMsg}
              <div className="mt-4 flex justify-center">
                 <button onClick={() => setRecordState('IDLE')} className="border border-[#1A3C2B] px-4 py-2 font-mono text-[12px]">[ RESET ]</button>
              </div>
           </div>
        )}
      </div>

      {recordState === 'COMPLETE' && analysisResult && (
        <div className="border border-[#1A3C2B]/20 p-8 flex flex-col gap-6 bg-white/50 backdrop-blur pb-10">
           <h3 className="font-mono text-[14px] uppercase tracking-widest border-b border-[#1A3C2B]/10 pb-4">FULL RECORDING ANALYSIS</h3>
           
           <div className="flex flex-col md:flex-row justify-between items-center py-4 gap-8">
              <div className="flex flex-col items-center min-w-[200px]">
                 <span className="font-mono text-[10px] uppercase tracking-widest opacity-60 mb-2">AI-GENERATED PROBABILITY</span>
                 <span className="font-grotesk text-[48px] font-bold text-[#1A3C2B] leading-none">{(analysisResult.p_fake * 100).toFixed(1)}%</span>
              </div>
              
              <div className="flex flex-col items-center gap-2 min-w-[200px]">
                 <div className={`px-6 py-2 border font-mono text-[14px] font-bold uppercase tracking-widest 
                   ${analysisResult.classification === 'likely_ai_generated' ? 'bg-[#FF8C69] text-[#1A3C2B] border-transparent' : 
                     analysisResult.classification === 'suspicious' ? 'bg-[#F4D35E] text-[#1A3C2B] border-transparent' : 
                     'border-[#1A3C2B] text-[#1A3C2B]'}`}>
                    {analysisResult.label}
                 </div>
              </div>
           </div>

           <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 border-t border-[#1A3C2B]/10 pt-8">
              <div className="flex flex-col">
                 <span className="font-mono text-[10px] uppercase opacity-50">Highest Window</span>
                 <span className="font-sans text-[16px] font-bold">
                    {analysisResult.highest_probability ? (analysisResult.highest_probability * 100).toFixed(1) + '%' : 'N/A'}
                 </span>
              </div>
              <div className="flex flex-col">
                 <span className="font-mono text-[10px] uppercase opacity-50">Windows Analyzed</span>
                 <span className="font-sans text-[16px] font-bold">{analysisResult.windows_analyzed || 'N/A'}</span>
              </div>
              <div className="flex flex-col">
                 <span className="font-mono text-[10px] uppercase opacity-50">Processing Time</span>
                 <span className="font-sans text-[16px] font-bold">
                    {analysisResult.processing_time ? analysisResult.processing_time.toFixed(2) + 's' : 'N/A'}
                 </span>
              </div>
              <div className="flex flex-col">
                 <span className="font-mono text-[10px] uppercase opacity-50">Duration Analysed</span>
                 <span className="font-sans text-[16px] font-bold">
                    {analysisResult.duration ? analysisResult.duration.toFixed(1) + 's' : 'N/A'}
                 </span>
              </div>
           </div>
           
           <div className="mt-8 flex justify-center">
             <button 
               onClick={handleStartRecording}
               className="bg-transparent border border-[#1A3C2B] text-[#1A3C2B] px-8 py-4 font-mono text-[14px] uppercase tracking-widest hover:bg-[#1A3C2B]/5 transition-colors">
               [ RECORD NEW SAMPLE ]
             </button>
           </div>
        </div>
      )}
    </div>
  );
};
