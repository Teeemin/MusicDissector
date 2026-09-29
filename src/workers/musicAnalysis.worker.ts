import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import wasmUrl from 'essentia.js/dist/essentia-wasm.es.js?url'
import { ANALYSIS_SAMPLE_RATE, ANALYSIS_VERSION } from '../analysis/analysisTypes'
import type { AnalysisMessage, MusicAnalysisResult } from '../analysis/analysisTypes'
import { normalizePitchName } from '../analysis/pitchNames'

const send = (message: AnalysisMessage) => self.postMessage(message)
self.onmessage = async ({ data: samples }: MessageEvent<Float32Array>) => {
  let essentia: Essentia | undefined
  let signal: ReturnType<Essentia['arrayToVector']> | undefined
  try {
    // Keep the upstream synchronous ESM WASM build intact; it runs only here.
    const { EssentiaWASM } = await import(/* @vite-ignore */ wasmUrl)
    essentia = new Essentia(EssentiaWASM)
    const result: MusicAnalysisResult = { bpm: null, beats: [], key: null, scale: null, confidence: {}, engineVersion: ANALYSIS_VERSION }
    let energy = 0
    for (const value of samples) energy += value * value
    if (samples.length < ANALYSIS_SAMPLE_RATE * 2 || energy / samples.length < 1e-10) {
      send({ kind: 'result', result }); return
    }
    signal = essentia.arrayToVector(samples)
    send({ kind: 'stage', stage: 'bpm' })
    try {
      const rhythm = essentia.RhythmExtractor2013(signal, 208, 'multifeature', 40)
      try {
        if (Number.isFinite(rhythm.confidence)) result.confidence.bpm = rhythm.confidence
        // Native multifeature confidence < 1 is insufficient evidence for a pulse.
        if (rhythm.confidence >= 1 && rhythm.bpm >= 40 && rhythm.bpm <= 208 && rhythm.ticks.size() >= 2) {
          result.bpm = rhythm.bpm
          for (let i = 0; i < rhythm.ticks.size(); i++) {
            const beat = rhythm.ticks.get(i)
            if (Number.isFinite(beat) && beat >= 0 && beat <= samples.length / ANALYSIS_SAMPLE_RATE
              && (result.beats.length === 0 || beat > result.beats[result.beats.length - 1])) result.beats.push(beat)
          }
          if (result.beats.length < 2) { result.bpm = null; result.beats = [] }
        }
      } finally { rhythm.ticks.delete(); rhythm.estimates.delete(); rhythm.bpmIntervals.delete() }
    } catch { /* Tonal analysis can still succeed when rhythm is unavailable. */ }
    send({ kind: 'stage', stage: 'key' })
    try {
      const tonal = essentia.KeyExtractor(signal)
      if (Number.isFinite(tonal.strength)) result.confidence.key = tonal.strength
      if (tonal.strength >= .5 && ['major', 'minor'].includes(tonal.scale)) {
        result.key = normalizePitchName(tonal.key)
        result.scale = result.key ? tonal.scale as 'major' | 'minor' : null
      }
    } catch { /* A rhythm-only result is useful; no invented key fallback. */ }
    send({ kind: 'result', result })
  } catch { send({ kind: 'error' }) }
  finally { signal?.delete(); essentia?.shutdown(); essentia?.delete() }
}
