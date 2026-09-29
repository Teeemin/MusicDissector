export const ANALYSIS_VERSION = 'essentia.js-0.1.3:rhythm-multifeature-key-bgate:v1'
export const ANALYSIS_SAMPLE_RATE = 44100

export interface MusicAnalysisResult {
  bpm: number | null
  beats: number[]
  key: string | null
  scale: 'major' | 'minor' | null
  /** Native algorithm scores, not calibrated probabilities. */
  confidence: { bpm?: number; key?: number }
  engineVersion: string
}
export type AnalysisStage = 'decoding' | 'bpm' | 'key'
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
export type AnalysisMessage = { kind: 'stage'; stage: 'bpm' | 'key' }
  | { kind: 'result'; result: MusicAnalysisResult }
  | { kind: 'error' }

export function validResult(value: unknown): value is MusicAnalysisResult {
  if (!value || typeof value !== 'object') return false
  const r = value as MusicAnalysisResult
  return r.engineVersion === ANALYSIS_VERSION
    && (r.bpm === null || (Number.isFinite(r.bpm) && r.bpm >= 40 && r.bpm <= 208))
    && Array.isArray(r.beats) && r.beats.every((v, i) => Number.isFinite(v) && v >= 0 && (i === 0 || v > r.beats[i - 1]))
    && (r.bpm === null ? r.beats.length === 0 : r.beats.length >= 2)
    && ((r.key === null && r.scale === null) || (/^[A-G]#?$/.test(r.key ?? '') && ['major', 'minor'].includes(r.scale ?? '')))
    && !!r.confidence && typeof r.confidence === 'object' && !Array.isArray(r.confidence)
    && Object.values(r.confidence).every((v) => typeof v === 'number' && Number.isFinite(v))
}
