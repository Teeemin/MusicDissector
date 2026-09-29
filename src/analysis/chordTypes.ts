import { normalizeChord } from './pitchNames'

export const CHORD_ENGINE_VERSION = 'essentia-0.1.3:hpcp8192-hop4410:templates9-viterbi:v1'
export interface ChordSegment { start: number; end: number; chord: string; confidence?: number }
export interface ChordAnalysisResult { chords: ChordSegment[]; engineVersion: string; analyzedAt: number }
export type ChordStage = 'waiting' | 'decoding' | 'extracting' | 'detecting'
export interface ChordState {
  trackId: number | null
  status: 'idle' | ChordStage | 'complete' | 'error'
  result: ChordAnalysisResult | null
  cached: boolean
}
export interface ChordOptions { signal: AbortSignal; onStage: (stage: ChordStage) => void }
export interface ChordEngine { analyze(file: File, options: ChordOptions): Promise<ChordAnalysisResult> }
export type ChordMessage = { kind: 'stage'; stage: ChordStage } | { kind: 'result'; result: ChordAnalysisResult } | { kind: 'error' }
export function validChordResult(value: unknown): value is ChordAnalysisResult {
  if (!value || typeof value !== 'object') return false
  const r = value as ChordAnalysisResult
  return r.engineVersion === CHORD_ENGINE_VERSION && Number.isFinite(r.analyzedAt) && r.analyzedAt > 0
    && Array.isArray(r.chords) && r.chords.every((s, i) => s && Number.isFinite(s.start) && s.start >= 0
      && Number.isFinite(s.end) && s.end > s.start && (i === 0 || s.start >= r.chords[i - 1].end)
      && typeof s.chord === 'string' && normalizeChord(s.chord) === s.chord
      && (s.confidence === undefined || (Number.isFinite(s.confidence) && s.confidence >= 0 && s.confidence <= 1)))
}
