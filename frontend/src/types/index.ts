export type AudioSource = 'laptop' | 'phone-wifi' | 'phone-usb';

export type PhoneConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'mic_ready'
  | 'streaming'
  | 'error';

export type UsbConnectionState = 'disconnected' | 'connected' | 'streaming' | 'error';

export interface AnalysisResult {
  filename: string;
  p_fake: number;
  classification: 'likely_real' | 'suspicious' | 'likely_ai_generated' | 'insufficient';
  label: string;
  highest_probability?: number;
  average_probability?: number;
  duration?: number;
  windows_analyzed?: number;
  windows_speech?: number;
  processing_time?: number;
  audio_quality?: 'good' | 'low' | 'insufficient';
  confidence?: number;
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
  classification: 'likely_real' | 'suspicious' | 'likely_ai_generated' | 'insufficient';
  risk_level: 'low' | 'medium' | 'high';
  model: string;
  windows_analyzed: number;
  windows_speech: number;
  confidence: number;
}

export interface PhoneStatusResponse {
  state: PhoneConnectionState;
  client_count: number;
}

export interface UsbStatusResponse {
  state: UsbConnectionState;
  last_audio_ts: number | null;
}

export interface LocalIpResponse {
  ip: string;
  port: number;
  mobile_url: string;
}
