import type { StemSeparationEngine, StemResult } from './StemSeparationEngine'
import type { SeparationOptions, SeparationProgress, SeparationErrorCode } from './separationTypes'
import { MAX_SECONDS, SAMPLE_RATE, STEM_OUTPUT_ORDER, SeparationError, classifyError } from './separationTypes'
import { OPFSModelCache } from './modelCache'
import type { StemAudioSource, StemId } from '../mixer/mixerTypes'

export class BSRoformerWebEngine implements StemSeparationEngine {
  async separate(file: File, options: SeparationOptions = {}): Promise<StemResult> {
    const signal = options.signal ?? new AbortController().signal
    signal.throwIfAborted()
    const modelFile = await new OPFSModelCache().read()
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../workers/stemAudio.worker.ts', import.meta.url), { type: 'module' })
      const visibility = () => worker.postMessage({ kind: 'visibility', hidden: document.hidden })
      const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', abort); document.removeEventListener('visibilitychange', visibility); worker.terminate() }
      const fail = (error: unknown) => { cleanup(); reject(error) }
      const abort = () => fail(new SeparationError('cancelled'))
      const timeout = setTimeout(() => fail(new SeparationError('inference', 'Separation timed out')), 30 * 60 * 1000)
      signal.addEventListener('abort', abort, { once: true })
      document.addEventListener('visibilitychange', visibility)
      worker.onerror = () => fail(new SeparationError('inference'))
      worker.onmessageerror = () => fail(new SeparationError('inference'))
      worker.onmessage = async ({ data }: MessageEvent<SeparationProgress & { kind: string; code: SeparationErrorCode; detail?: string; outputs: Float32Array<ArrayBuffer>[] }>) => {
        if (signal.aborted) return
        if (data.kind === 'error') { console.error('Stem separation:', data.detail); fail(new SeparationError(data.code)); return }
        if (data.kind === 'progress') { options.onProgress?.(data); return }
        try {
          if (data.kind === 'ready') {
            options.onProgress?.({ stage: 'audio-decoding', completed: 0, total: 0 })
            if (file.size > 128 * 1024 * 1024) throw new SeparationError('memory')
            const context = new OfflineAudioContext(2, 1, SAMPLE_RATE)
            const decoded = await context.decodeAudioData(await file.arrayBuffer())
            signal.throwIfAborted()
            if (decoded.duration > MAX_SECONDS || decoded.numberOfChannels > 2) throw new SeparationError(decoded.duration > MAX_SECONDS ? 'memory' : 'audio-decode')
            const left = decoded.getChannelData(0).slice()
            const right = decoded.getChannelData(decoded.numberOfChannels === 1 ? 0 : 1).slice()
            worker.postMessage({ kind: 'separate', left, right }, [left.buffer, right.buffer])
          } else if (data.kind === 'result') {
            cleanup() // release model/GPU heap before allocating Web Audio buffers
            if (data.outputs.length !== 6 || data.outputs.some((a) => !(a instanceof Float32Array) || a.length === 0 || a.length % 2 || a.length !== data.outputs[0].length)) throw new SeparationError('inference', 'Invalid stem buffers')
            const stems = {} as Record<StemId, StemAudioSource>
            for (let i = 0; i < STEM_OUTPUT_ORDER.length; i++) {
              signal.throwIfAborted()
              const planar = data.outputs[i]
              const length = planar.length / 2
              const buffer = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: SAMPLE_RATE })
              buffer.copyToChannel(planar.subarray(0, length), 0)
              buffer.copyToChannel(planar.subarray(length), 1)
              stems[STEM_OUTPUT_ORDER[i]] = { kind: 'buffer', buffer }
              data.outputs[i] = new Float32Array(0)
              await new Promise((r) => setTimeout(r, 0))
            }
            signal.throwIfAborted()
            resolve({ kind: 'separated', processed: true, stems })
          }
        } catch (error) { fail(new SeparationError(classifyError(error, data.kind === 'ready' ? 'audio-decode' : 'memory'))) }
      }
      worker.postMessage({ kind: 'init', file: modelFile })
      visibility()
    })
  }
}
