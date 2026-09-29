export const ANALYSIS_VERSION = 'essentia.js-0.1.3:rhythm-multifeature:v2'
export const ANALYSIS_SAMPLE_RATE = 44100

export interface MusicAnalysisResult {
  bpm: number | null
  beats: number[]
  /** Native algorithm scores, not calibrated probabilities. */
  confidence: { bpm?: number }
  engineVersion: string
}
export type AnalysisStage = 'decoding' | 'bpm'
export interface AnalysisState {
  trackId: number | null
  status: 'idle' | 'decoding' | 'analyzing' | 'complete' | 'error'
  stage: AnalysisStage | null
  result: MusicAnalysisResult | null
  cached: boolean
}
export interface AnalysisOptions {
  signal: AbortSignal
  onStage: (stage: AnalysisStage) => void
}
export interface AnalysisEngine {
  analyze(file: File, options: AnalysisOptions): Promise<MusicAnalysisResult>
}
export type AnalysisMessage = { kind: 'stage'; stage: 'bpm' }
  | { kind: 'result'; result: MusicAnalysisResult }
  | { kind: 'error' }

export function validResult(value: unknown): value is MusicAnalysisResult {
  if (!value || typeof value !== 'object') return false
  const r = value as MusicAnalysisResult
  return r.engineVersion === ANALYSIS_VERSION
    && (r.bpm === null || (Number.isFinite(r.bpm) && r.bpm >= 40 && r.bpm <= 208))
    && Array.isArray(r.beats) && r.beats.every((v, i) => Number.isFinite(v) && v >= 0 && (i === 0 || v > r.beats[i - 1]))
    && (r.bpm === null ? r.beats.length === 0 : r.beats.length >= 2)
    && !('key' in r) && !('scale' in r)
    && !!r.confidence && typeof r.confidence === 'object' && !Array.isArray(r.confidence)
    && Object.entries(r.confidence).every(([name, v]) => name === 'bpm' && typeof v === 'number' && Number.isFinite(v))
}
