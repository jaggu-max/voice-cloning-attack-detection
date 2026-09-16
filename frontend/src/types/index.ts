export interface AnalysisResult {
  filename: string;
  p_fake: number;
  classification: 'likely_real' | 'suspicious' | 'likely_ai_generated';
  label: 'Likely Real' | 'Suspicious' | 'Likely AI-Generated';
  highest_probability?: number;
  average_probability?: number;
  duration?: number;
  windows_analyzed?: number;
  processing_time?: number;
}

export interface HealthResponse {
  status: string;
  model: string;
  ffmpeg: boolean;
  model_file: boolean;
}

export interface LiveAnalysisResult {
  window_start: number;
  window_end: number;
  p_fake: number;
  classification: 'likely_real' | 'suspicious' | 'likely_ai_generated';
  risk_level: 'low' | 'medium' | 'high';
  model: string;
  windows_analyzed: number;
}
