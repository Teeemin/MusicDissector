/** Transfer mono audio and reclaim the entire WASM heap on finish or cancellation. */
export function runAnalysisWorker<T, S extends string>(worker: Worker, samples: Float32Array<ArrayBuffer>, signal: AbortSignal,
  onStage: (stage: S) => void, validate: (value: unknown) => value is T): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate() }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const abort = () => fail(new DOMException('Aborted', 'AbortError'))
    const timeout = setTimeout(() => fail(new Error('Analysis timed out')), 180_000)
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => fail(new Error('Analysis worker failed'))
    worker.onmessageerror = () => fail(new Error('Invalid analysis response'))
    worker.onmessage = ({ data }: MessageEvent<{ kind: string; stage: S; result: unknown }>) => {
      if (data.kind === 'stage') onStage(data.stage)
      else if (data.kind === 'result' && validate(data.result)) { cleanup(); resolve(data.result) }
      else fail(new Error('Cannot analyze this audio'))
    }
    try { worker.postMessage(samples, [samples.buffer]) } catch { fail(new Error('Cannot transfer analysis audio')) }
  })
}
