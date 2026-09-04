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
import { api } from './services/api';
import type { AnalysisResult } from './types';

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            <div className="mb-12 text-center">
              <span className="font-mono text-[10px] uppercase tracking-widest opacity-50 mb-4 block">02 / AUDIO ANALYSIS</span>
              <h2 className="font-grotesk text-[36px] md:text-[48px] font-bold text-[#1A3C2B] leading-[1.1] mb-6">Analyze a voice<br/>recording.</h2>
              <p className="font-sans text-[15px] opacity-70 leading-relaxed max-w-[480px] mx-auto">
                Upload a recording to evaluate whether the speech appears likely to be human-generated or AI-generated.
              </p>
            </div>

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
