// Narrow declarations verified against essentia.js@0.1.3/dist/essentia.js-core.es.js.
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  interface VectorFloat { size(): number; get(index: number): number; delete(): void }
  export default class Essentia {
    constructor(module: unknown)
    arrayToVector(input: Float32Array): VectorFloat
    RhythmExtractor2013(input: VectorFloat, maxTempo?: number, method?: string, minTempo?: number): {
      bpm: number; confidence: number; ticks: VectorFloat; estimates: VectorFloat; bpmIntervals: VectorFloat
    }
    KeyExtractor(input: VectorFloat): { key: string; scale: string; strength: number }
    Windowing(input: VectorFloat, normalized?: boolean, size?: number, type?: string, zeroPadding?: number, zeroPhase?: boolean): { frame: VectorFloat }
    Spectrum(input: VectorFloat, size?: number): { spectrum: VectorFloat }
    SpectralPeaks(input: VectorFloat, threshold?: number, maxFrequency?: number, maxPeaks?: number, minFrequency?: number, orderBy?: string, sampleRate?: number): { frequencies: VectorFloat; magnitudes: VectorFloat }
    HPCP(frequencies: VectorFloat, magnitudes: VectorFloat, bandPreset?: boolean, bandSplitFrequency?: number, harmonics?: number, maxFrequency?: number, maxShifted?: boolean, minFrequency?: number, nonLinear?: boolean, normalized?: string, referenceFrequency?: number, sampleRate?: number, size?: number, weightType?: string, windowSize?: number): { hpcp: VectorFloat }
    shutdown(): void
    delete(): void
  }
}
