// Narrow declarations verified against essentia.js@0.1.3/dist/essentia.js-core.es.js.
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  interface VectorFloat { size(): number; get(index: number): number; delete(): void }
  export default class Essentia {
    constructor(module: unknown)
    arrayToVector(input: Float32Array): VectorFloat
    RhythmExtractor2013(input: VectorFloat, maxTempo?: number, method?: string, minTempo?: number): {
      bpm: number; confidence: number; ticks: VectorFloat; estimates: VectorFloat; bpmIntervals: VectorFloat
    }
    shutdown(): void
    delete(): void
  }
}
