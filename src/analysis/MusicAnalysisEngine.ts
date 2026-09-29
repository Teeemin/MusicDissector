import { decodeForAnalysis } from './audioDecode'
import { validResult } from './analysisTypes'
import type { AnalysisEngine, AnalysisOptions, MusicAnalysisResult } from './analysisTypes'
import { runAnalysisWorker } from './workerJob'

export class MusicAnalysisEngine implements AnalysisEngine {
  async analyze(file: File, { signal, onStage }: AnalysisOptions): Promise<MusicAnalysisResult> {
    signal.throwIfAborted()
    onStage('decoding')
    const samples = await decodeForAnalysis(file, signal)
    signal.throwIfAborted()
    const worker = new Worker(new URL('../workers/musicAnalysis.worker.ts', import.meta.url), { type: 'module' })
    return runAnalysisWorker(worker, samples, signal, onStage, validResult)
  }
}
