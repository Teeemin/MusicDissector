import { decodeForAnalysis } from './audioDecode'
import { validResult } from './analysisTypes'
import type { AnalysisEngine, AnalysisMessage, AnalysisOptions, MusicAnalysisResult } from './analysisTypes'

export class MusicAnalysisEngine implements AnalysisEngine {
  async analyze(file: File, { signal, onStage }: AnalysisOptions): Promise<MusicAnalysisResult> {
    signal.throwIfAborted()
    onStage('decoding')
    const samples = await decodeForAnalysis(file, signal)
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/musicAnalysis.worker.ts', import.meta.url), { type: 'module' })
      const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate() }
      const fail = (error: Error) => { cleanup(); reject(error) }
      const abort = () => fail(new DOMException('Aborted', 'AbortError'))
      const timeout = setTimeout(() => fail(new Error('Analysis timed out')), 180_000)
      signal.addEventListener('abort', abort, { once: true })
      worker.onerror = () => fail(new Error('Analysis worker failed'))
      worker.onmessageerror = () => fail(new Error('Invalid analysis response'))
      worker.onmessage = ({ data }: MessageEvent<AnalysisMessage>) => {
        if (data.kind === 'stage') onStage(data.stage)
        else if (data.kind === 'result' && validResult(data.result)) { cleanup(); resolve(data.result) }
        else fail(new Error('Cannot analyze this audio'))
      }
      try { worker.postMessage(samples, [samples.buffer]) } catch { fail(new Error('Cannot transfer analysis audio')) }
    })
  }
}
