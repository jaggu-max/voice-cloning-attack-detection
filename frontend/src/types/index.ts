export interface AnalysisResult {
  filename: string;
  p_fake: number;
  classification: 'likely_real' | 'likely_ai_generated';
  label: 'Likely Real' | 'Likely AI-Generated';
}

export interface HealthResponse {
  status: string;
  model: string;
  ffmpeg: boolean;
  model_file: boolean;
}
