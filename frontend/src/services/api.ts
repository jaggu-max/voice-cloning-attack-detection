import type { AnalysisResult, HealthResponse } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const api = {
  checkHealth: async (): Promise<HealthResponse> => {
    try {
      const res = await fetch(`${API_URL}/api/health`);
      if (!res.ok) {
        throw new Error('Health check failed');
      }
      return await res.json();
    } catch (e: any) {
      throw new Error(e.message || 'Network error');
    }
  },

  analyzeAudio: async (file: File): Promise<AnalysisResult> => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        let msg = 'An error occurred during analysis.';
        try {
          const data = await res.json();
          msg = data.detail || msg;
        } catch { } // ignore JSON parsing errors for error response
        throw new ApiError(msg, res.status);
      }

      return await res.json();
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      throw new Error('Network failure or backend unavailable.');
    }
  }
};
