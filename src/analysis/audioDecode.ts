import { ANALYSIS_SAMPLE_RATE } from './analysisTypes'

// Native decoding cannot be aborted. Serialize it to avoid overlapping large buffers
// when several tracks are selected rapidly; cancelled queued work never decodes.
let decodeQueue: Promise<unknown> = Promise.resolve()
export function decodeForAnalysis(file: File, signal: AbortSignal): Promise<Float32Array<ArrayBuffer>> {
  const task = decodeQueue.catch(() => {}).then(async () => {
    signal.throwIfAborted()
    if (file.size > 256 * 1024 * 1024) throw new Error('Analysis file exceeds memory budget')
    const bytes = await file.arrayBuffer()
    signal.throwIfAborted()
    // Offline context is only a decoder/resampler: never connected to playback.
    const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE)
    const audio = await context.decodeAudioData(bytes)
    signal.throwIfAborted()
    if (audio.duration > 15 * 60 || audio.length * audio.numberOfChannels * 4 > 256 * 1024 * 1024) {
      throw new Error('Decoded audio exceeds analysis memory budget')
    }
    const mono = new Float32Array(audio.length)
    const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
    for (let start = 0; start < mono.length; start += 65536) {
      signal.throwIfAborted()
      const end = Math.min(start + 65536, mono.length)
      for (const channel of channels) {
        for (let i = start; i < end; i++) mono[i] += channel[i] / channels.length
      }
      // Yield between small blocks for touch, playback and paint on mobile.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    signal.throwIfAborted()
    return mono
  })
  decodeQueue = task.then(() => undefined, () => undefined)
  return task
}
