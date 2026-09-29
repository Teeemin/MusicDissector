import { decodeForAnalysis } from './audioDecode'
import { validChordResult } from './chordTypes'
import type { ChordEngine, ChordOptions } from './chordTypes'
import { runAnalysisWorker } from './workerJob'

export class ChordAnalysisEngine implements ChordEngine {
  async analyze(file: File, { signal, onStage }: ChordOptions) {
    signal.throwIfAborted()
    onStage('decoding')
    const samples = await decodeForAnalysis(file, signal)
    signal.throwIfAborted()
    const worker = new Worker(new URL('../workers/chordAnalysis.worker.ts', import.meta.url), { type: 'module' })
    return runAnalysisWorker(worker, samples, signal, onStage, validChordResult)
  }
}
