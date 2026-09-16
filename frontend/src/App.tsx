import { useState } from 'react';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { UploadZone } from './components/UploadZone';
import { AudioPreview } from './components/AudioPreview';
import { AnalysisLoader } from './components/AnalysisLoader';
import { DetectionResult } from './components/DetectionResult';
import { HowItWorks } from './components/HowItWorks';
import { NetworkTopology } from './components/NetworkTopology';
import { SystemBento } from './components/SystemBento';
import { ValidationSection } from './components/ValidationSection';
import { Footer } from './components/Footer';
import { LiveProtection } from './components/LiveProtection';
import { RecordTest } from './components/RecordTest';
import { api } from './services/api';
import type { AnalysisResult } from './types';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'upload' | 'live' | 'record'>('upload');

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setResult(null);
    setError(null);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await api.analyzeAudio(file);
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <main>
        <Hero />
        
        <section id="detect" className="py-20 lg:py-32 px-8 md:px-[64px] border-b border-hairline flex justify-center">
          <div className="w-full max-w-[800px]">
            <div className="mb-8 text-center">
              <span className="font-mono text-[10px] uppercase tracking-widest opacity-50 mb-4 block">02 / AUDIO ANALYSIS</span>
              <h2 className="font-grotesk text-[36px] md:text-[48px] font-bold text-[#1A3C2B] leading-[1.1] mb-6">Voice Investigation</h2>
              
              <div className="flex justify-center gap-4 mb-4 mt-8">
                <button 
                  onClick={() => setMode('upload')}
                  className={`px-6 py-3 font-mono text-[12px] uppercase tracking-widest transition-colors ${mode === 'upload' ? 'bg-[#1A3C2B] text-[#FFF6E5]' : 'border border-[#1A3C2B] text-[#1A3C2B] hover:bg-[#1A3C2B]/5'}`}>
                  File Analysis
                </button>
                <button 
                  onClick={() => setMode('live')}
                  className={`px-6 py-3 font-mono text-[12px] uppercase tracking-widest transition-colors ${mode === 'live' ? 'bg-[#1A3C2B] text-[#FFF6E5]' : 'border border-[#1A3C2B] text-[#1A3C2B] hover:bg-[#1A3C2B]/5'}`}>
                  Live Protection
                </button>
                <button 
                  onClick={() => setMode('record')}
                  className={`px-6 py-3 font-mono text-[12px] uppercase tracking-widest transition-colors ${mode === 'record' ? 'bg-[#1A3C2B] text-[#FFF6E5]' : 'border border-[#1A3C2B] text-[#1A3C2B] hover:bg-[#1A3C2B]/5'}`}>
                  Record & Test
                </button>
              </div>
            </div>

            <div className={mode === 'upload' ? 'block' : 'hidden'}>
              {error && (
                <div className="mb-8 p-6 border border-[#FF8C69]/50 bg-[#FF8C69]/5 text-[#1A3C2B] flex flex-col gap-2">
                   <div className="font-mono text-[10px] uppercase tracking-widest opacity-60">ANALYSIS ERROR</div>
                   <div className="font-sans text-[14px]">{error}</div>
                </div>
              )}

              {!file && !isAnalyzing && !result && (
                <UploadZone onFileSelect={handleFileSelect} />
              )}

              {file && !isAnalyzing && !result && (
                <AudioPreview file={file} onAnalyze={handleAnalyze} onRemove={handleReset} />
              )}

              {isAnalyzing && (
                <AnalysisLoader />
              )}

              {result && !isAnalyzing && (
                <DetectionResult result={result} onReset={handleReset} />
              )}
            </div>

            <div className={mode === 'live' ? 'block' : 'hidden'}>
              <LiveProtection />
            </div>

            <div className={mode === 'record' ? 'block' : 'hidden'}>
              <RecordTest />
            </div>
          </div>
        </section>

        <HowItWorks />
        <NetworkTopology />
        <SystemBento />
        <ValidationSection />
      </main>
      <Footer />
    </div>
  );
}

export default App;
