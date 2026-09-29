import Essentia from 'essentia.js/dist/essentia.js-core.es.js'
import wasmUrl from 'essentia.js/dist/essentia-wasm.es.js?url'
import { ANALYSIS_SAMPLE_RATE } from '../analysis/analysisTypes'
import { CHORD_ENGINE_VERSION } from '../analysis/chordTypes'
import type { ChordMessage } from '../analysis/chordTypes'
import { CHORD_FRAME_SIZE, CHORD_HOP_SIZE, scoreChroma, smoothChordFrames } from '../analysis/chordDetection'

const send = (message: ChordMessage) => self.postMessage(message)
self.onmessage = async ({ data: samples }: MessageEvent<Float32Array>) => {
  let essentia: Essentia | undefined
  try {
    const { EssentiaWASM } = await import(/* @vite-ignore */ wasmUrl)
    essentia = new Essentia(EssentiaWASM)
    send({ kind: 'stage', stage: 'extracting' })
    const scores: Float32Array[] = []
    const frame = new Float32Array(CHORD_FRAME_SIZE)
    for (let center = 0; center < samples.length; center += CHORD_HOP_SIZE) {
      frame.fill(0)
      const start = center - CHORD_FRAME_SIZE / 2
      const from = Math.max(0, start)
      const to = Math.min(samples.length, start + CHORD_FRAME_SIZE)
      frame.set(samples.subarray(from, to), from - start)
      let energy = 0
      for (const value of frame) energy += value * value
      const rms = Math.sqrt(energy / frame.length)
      if (rms < 1e-5) { scores.push(scoreChroma(new Array(12).fill(0), rms)); continue }
      const native: { delete(): void }[] = []
      const keep = <T extends { delete(): void }>(vector: T): T => { native.push(vector); return vector }
      try {
        const input = keep(essentia.arrayToVector(frame))
        const windowed = keep(essentia.Windowing(input, true, CHORD_FRAME_SIZE, 'blackmanharris92').frame)
        const spectrum = keep(essentia.Spectrum(windowed, CHORD_FRAME_SIZE).spectrum)
        let arithmetic = 0; let geometric = 0
        const bins = spectrum.size() - 1
        for (let b = 1; b <= bins; b++) { const v = Math.max(1e-12, spectrum.get(b)); arithmetic += v; geometric += Math.log(v) }
        const flatness = Math.exp(geometric / bins) / (arithmetic / bins)
        const peaks = essentia.SpectralPeaks(spectrum, .00001, 3500, 60, 55, 'magnitude', ANALYSIS_SAMPLE_RATE)
        keep(peaks.frequencies); keep(peaks.magnitudes)
        const profile = keep(essentia.HPCP(peaks.frequencies, peaks.magnitudes, false, 500, 0, 3500, false, 55, false, 'unitMax', 440, ANALYSIS_SAMPLE_RATE, 12).hpcp)
        // Essentia starts at A; templates and UI use C-first pitch classes.
        const chroma = Array.from({ length: 12 }, (_, pitch) => profile.get((pitch + 3) % 12))
        scores.push(scoreChroma(chroma, rms, flatness))
      } finally { for (const vector of native.reverse()) vector.delete() }
    }
    send({ kind: 'stage', stage: 'detecting' })
    const chords = smoothChordFrames(scores, samples.length / ANALYSIS_SAMPLE_RATE)
    send({ kind: 'result', result: { chords, engineVersion: CHORD_ENGINE_VERSION, analyzedAt: Date.now() } })
  } catch { send({ kind: 'error' }) }
  finally { essentia?.shutdown(); essentia?.delete() }
}
