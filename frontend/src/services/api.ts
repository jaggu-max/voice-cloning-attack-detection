import type {
  AnalysisResult,
  HealthResponse,
  LiveAnalysisResult,
  PhoneStatusResponse,
  UsbStatusResponse,
  LocalIpResponse,
} from '../types';

const getBaseHost = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace(/^https?:\/\//, '');
  }
  const host = window.location.hostname || '127.0.0.1';
  return `${host}:8000`;
};

let cachedApiUrl: string | null = null;

export async function detectWorkingApiUrl(): Promise<string> {
  if (cachedApiUrl) return cachedApiUrl;
  if (import.meta.env.VITE_API_URL) {
    cachedApiUrl = import.meta.env.VITE_API_URL;
    return cachedApiUrl;
  }

  const host = getBaseHost();
  // Try HTTPS first (since backend runs with SSL), then HTTP
  const schemes = ['https', 'http'];

  for (const s of schemes) {
    const candidate = `${s}://${host}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${candidate}/api/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        cachedApiUrl = candidate;
        return candidate;
      }
    } catch {
      /* try next scheme */
    }
  }

  // Fallback to default HTTPS
  cachedApiUrl = `https://${host}`;
  return cachedApiUrl;
}

export const getApiUrl = (): string => {
  if (cachedApiUrl) return cachedApiUrl;
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  const s = window.location.protocol === 'https:' ? 'https' : 'http';
  return `${s}://${getBaseHost()}`;
};

export const getWsUrl = (path: string): string => {
  const activeUrl = getApiUrl();
  const protocol = activeUrl.startsWith('https') ? 'wss:' : 'ws:';
  return `${protocol}//${getBaseHost()}${path}`;
};

export const WS_PHONE_URL = getWsUrl('/ws/phone');

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function fetchJson<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const baseUrl = await detectWorkingApiUrl();
  const url = `${baseUrl}${endpoint}`;

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err: any) {
    // If HTTPS fetch failed (e.g. self-signed cert untrusted), reset cache and try HTTP
    if (baseUrl.startsWith('https')) {
      cachedApiUrl = `http://${getBaseHost()}`;
      try {
        res = await fetch(`${cachedApiUrl}${endpoint}`, options);
      } catch {
        throw new Error('Network failure or backend unavailable. Check backend logs or accept SSL cert.');
      }
    } else {
      throw new Error('Network failure or backend unavailable. Is backend running?');
    }
  }

  if (!res.ok) {
    let msg = 'An error occurred.';
    try {
      const data = await res.json();
      msg = data.detail || msg;
    } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  checkHealth: (): Promise<HealthResponse> =>
    fetchJson<HealthResponse>('/api/health').catch((e: any) => {
      throw new Error(e.message || 'Network error');
    }),

  analyzeAudio: async (file: File): Promise<AnalysisResult> => {
    const fd = new FormData();
    fd.append('file', file);
    return fetchJson<AnalysisResult>('/api/analyze', {
      method: 'POST',
      body: fd,
    });
  },

  analyzeLiveAudio: async (
    audioBlob: Blob,
    windowStart: number,
    windowEnd: number,
  ): Promise<LiveAnalysisResult> => {
    const fd = new FormData();
    fd.append('audio', audioBlob, 'live_segment.webm');
    fd.append('window_start', windowStart.toString());
    fd.append('window_end', windowEnd.toString());
    return fetchJson<LiveAnalysisResult>('/api/live/analyze', {
      method: 'POST',
      body: fd,
    });
  },

  downloadLiveMp3: async (audioBlob: Blob): Promise<Blob> => {
    const baseUrl = await detectWorkingApiUrl();
    const fd = new FormData();
    fd.append('audio', audioBlob, 'live_segment.webm');
    const res = await fetch(`${baseUrl}/api/live/download-mp3`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('MP3 conversion failed.');
    return res.blob();
  },

  downloadFullLiveMp3: async (audioBlobs: Blob[]): Promise<Blob> => {
    const baseUrl = await detectWorkingApiUrl();
    const fd = new FormData();
    audioBlobs.forEach((blob, i) => fd.append('files', blob, `segment_${i}.webm`));
    const res = await fetch(`${baseUrl}/api/live/download-full-mp3`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Full session MP3 conversion failed.');
    return res.blob();
  },

  getPhoneStatus: (): Promise<PhoneStatusResponse> =>
    fetchJson<PhoneStatusResponse>('/api/phone/status'),

  getSessionToken: (): Promise<{ token: string; mobile_url: string }> =>
    fetchJson<{ token: string; mobile_url: string }>('/api/session-token'),

  downloadLatestPhoneWav: async (): Promise<Blob> => {
    const baseUrl = await detectWorkingApiUrl();
    const res = await fetch(`${baseUrl}/api/phone/latest-wav`);
    if (!res.ok) throw new Error('No recorded phone audio available.');
    return res.blob();
  },

  analyzePhoneRecording: (): Promise<AnalysisResult> =>
    fetchJson<AnalysisResult>('/api/phone/analyze-recording', { method: 'POST' }),

  getUsbStatus: (): Promise<UsbStatusResponse> =>
    fetchJson<UsbStatusResponse>('/api/usb/status'),

  getLocalIp: (): Promise<LocalIpResponse> =>
    fetchJson<LocalIpResponse>('/api/local-ip'),
};
