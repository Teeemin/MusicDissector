import type { MetadataResponse, MetadataResult } from './types'

/** One cancellable worker per selection; terminate it when the track changes. */
export function readMetadata(file: File, signal: AbortSignal): Promise<MetadataResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const worker = new Worker(new URL('./metadata.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const abort = () => fail(new DOMException('Aborted', 'AbortError'))
    const timeout = setTimeout(() => fail(new Error('Metadata read timed out')), 30_000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<MetadataResponse>) => {
      cleanup()
      if (event.data.ok) resolve(event.data.result)
      else reject(new Error('Cannot read embedded metadata'))
    }
    worker.onerror = () => fail(new Error('Metadata worker failed'))
    worker.onmessageerror = () => fail(new Error('Invalid metadata response'))
    try { worker.postMessage(file) } catch { fail(new Error('Cannot open file in worker')) }
  })
}
