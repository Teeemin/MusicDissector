import { expect, test } from '@playwright/test'
import { stftStereo, istftBatch } from '../src/separation/dsp/stft'
import { buildChunk, overlapWeight, addChunk } from '../src/separation/separationPipeline'
import { CHUNK_SAMPLES, OVERLAP, STEP, STFT_SETTINGS, STEM_OUTPUT_ORDER, chunkCount, progressFraction, SeparationError, MODEL } from '../src/separation/separationTypes'
import { SeparationStore } from '../src/separation/separationStore'
import { MixerStore } from '../src/mixer/mixerStore'
import { effectiveGain } from '../src/mixer/mixerRules'
import type { StemResult, StemSeparationEngine } from '../src/separation/StemSeparationEngine'
import type { ModelStorage } from '../src/separation/modelCache'
import type { SeparationOptions } from '../src/separation/separationTypes'

test('STFT/iSTFT round trip preserves stereo, edges and near-Nyquist content', () => {
  const length = CHUNK_SAMPLES
  const audio = new Float32Array(length * 2)
  for (let i = 0; i < length; i++) { audio[i] = .2 * Math.sin(i * .13) + .1 * Math.cos(i * 3.12); audio[length + i] = .3 * Math.sin(i * .43) }
  const { real, imag, F, T } = stftStereo(audio, STFT_SETTINGS)
  expect([F, T]).toEqual([1025, 345])
  const output = new Float32Array(istftBatch({ realBuf: real.buffer, imagBuf: imag.buffer, numStems: 1, numChannels: 2, F, T, length, ...STFT_SETTINGS }).audioBuf)
  let maxError = 0
  for (let i = 0; i < audio.length; i++) maxError = Math.max(maxError, Math.abs(audio[i] - output[i]))
  expect(maxError).toBeLessThan(.00001)
})
test('chunk shape, actual progress and overlap-add preserve boundaries and stem order', () => {
  expect(STEM_OUTPUT_ORDER).toEqual(['bass', 'drums', 'others', 'vocals', 'guitar', 'piano'])
  expect(chunkCount(CHUNK_SAMPLES)).toBe(1); expect(chunkCount(CHUNK_SAMPLES + 1)).toBe(2)
  expect(progressFraction(18, 25)).toBe(.72); expect(progressFraction(5, 0)).toBe(0)
  for (let i = 0; i < OVERLAP; i += 111) expect(overlapWeight(0, STEP + i, 2) + overlapWeight(1, i, 2)).toBeCloseTo(1)
  const length = CHUNK_SAMPLES + 345
  const left = new Float32Array(length).fill(.25), right = new Float32Array(length).fill(-.2)
  const outputs = STEM_OUTPUT_ORDER.map(() => new Float32Array(length * 2))
  for (let i = 0; i < chunkCount(length); i++) {
    const chunk = buildChunk(left, right, i)
    const stems = new Float32Array(CHUNK_SAMPLES * 12)
    for (let s = 0; s < 6; s++) stems.set(chunk.planar, s * 2 * CHUNK_SAMPLES)
    addChunk(outputs, stems, i, chunk.length, length)
  }
  for (const out of outputs) for (const i of [0, STEP, CHUNK_SAMPLES - 1, length - 1]) { expect(out[i]).toBeCloseTo(.25); expect(out[length + i]).toBeCloseTo(-.2) }
})

const file = () => new File(['audio'], 'song.wav')
const separated = (): Extract<StemResult, { processed: true }> => ({ kind: 'separated', processed: true, stems: Object.fromEntries(STEM_OUTPUT_ORDER.map((id) => [id, { kind: 'buffer', buffer: { duration: 4, length: 176400, sampleRate: 44100 } }])) as Extract<StemResult, { processed: true }>['stems'] })
const capable = async () => ({ supported: true, adapter: 'test', reason: '' })
function fakeCache(ready = true) {
  let installed = ready
  const cache: ModelStorage = { ready: async () => installed, read: async () => file(), remove: async () => { installed = false }, download: async (_signal, progress) => { progress(100, MODEL.bytes); installed = true; progress(MODEL.bytes, MODEL.bytes) } }
  return cache
}
const settle = () => new Promise((r) => setTimeout(r, 0))

test('model state is explicit; initialization never downloads and cache deletion resets it', async () => {
  const cache = fakeCache(false)
  const store = new SeparationStore({ separate: async () => separated() }, cache, new MixerStore(), capable)
  await store.initialize(); expect(store.getSnapshot().model).toBe('not-downloaded')
  await store.download(); expect(store.getSnapshot().model).toBe('ready'); expect(store.getSnapshot().loaded).toBe(MODEL.bytes)
  await store.deleteModel(); expect(store.getSnapshot().model).toBe('not-downloaded')
})
test('download failure/cancel and unsupported GPU preserve player-independent state', async () => {
  const cache = fakeCache(false)
  cache.download = async () => { throw new SeparationError('download') }
  const store = new SeparationStore({ separate: async () => separated() }, cache, new MixerStore(), capable)
  await store.initialize(); await store.download(); expect(store.getSnapshot().errorCode).toBe('download')
  cache.download = (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
  const task = store.download(); store.cancelDownload(); await task
  expect(store.getSnapshot().model).toBe('not-downloaded')
  const unsupported = new SeparationStore({ separate: async () => { throw new Error('must not run') } }, fakeCache(), new MixerStore(), async () => ({ supported: false, reason: 'unsupported', adapter: '' }))
  await unsupported.initialize(); unsupported.selectFile(file(), 1); await unsupported.start(4)
  expect(unsupported.getSnapshot().errorCode).toBe('unsupported')
})
test('separation publishes exactly six real sources and Guitar solo/no-guitar route correctly', async () => {
  const mixer = new MixerStore(); mixer.selectFile(file(), 1); await settle()
  const result = separated()
  const store = new SeparationStore({ separate: async (_f, options) => { options?.onProgress?.({ stage: 'separating', completed: 1, total: 1 }); return result } }, fakeCache(), mixer, capable)
  await store.initialize(); store.selectFile(file(), 1); await store.start(4)
  expect(store.getSnapshot().stage).toBe('complete')
  for (const id of STEM_OUTPUT_ORDER) expect(mixer.getSnapshot().channels[id].source).toBe(result.stems[id])
  mixer.toggleSolo('guitar'); expect(effectiveGain(mixer.getSnapshot().channels, 'guitar')).toBe(1); expect(effectiveGain(mixer.getSnapshot().channels, 'vocals')).toBe(0)
  mixer.applyPreset('no-guitar'); expect(effectiveGain(mixer.getSnapshot().channels, 'guitar')).toBe(0)
  mixer.clear(); store.clear()
})
test('cancel and replacement ignore stale output/progress; retry clears prior sources', async () => {
  const jobs: { options?: SeparationOptions; resolve: (r: StemResult) => void }[] = []
  const engine: StemSeparationEngine = { separate: (_f, options) => new Promise((resolve) => jobs.push({ options, resolve })) }
  const mixer = new MixerStore(); mixer.selectFile(file(), 1); await settle()
  const store = new SeparationStore(engine, fakeCache(), mixer, capable); await store.initialize()
  store.selectFile(file(), 1); const first = store.start(4); await settle()
  store.cancel(); expect(jobs[0].options?.signal?.aborted).toBe(true)
  mixer.selectFile(file(), 2); store.selectFile(file(), 2); await settle()
  const next = store.start(4); await settle()
  jobs[0].options?.onProgress?.({ stage: 'complete', completed: 99, total: 99 }); jobs[0].resolve(separated()); await first
  expect(store.getSnapshot().stage).not.toBe('complete')
  jobs[1].resolve(separated()); await next; expect(store.getSnapshot().stage).toBe('complete')
  const retry = store.start(4); await settle(); expect(mixer.getSnapshot().channels.guitar.source).toBeNull()
  store.cancel(); jobs[2].resolve(separated()); await retry; expect(store.getSnapshot().stage).toBe('cancelled')
  store.clear(); mixer.clear()
})

test('duration accepts through 360 seconds regardless of bitrate and preserves the 128 MiB limit', async () => {
  const cases = [
    ...[196, 203, 240, 253, 359.999, 360].flatMap(duration => [128, 320].map(kbps => ({
      duration, size: Math.ceil(duration * kbps * 1000 / 8), allowed: true,
    }))),
    { duration: 360.001, size: 1000, allowed: false },
    { duration: 361, size: 1000, allowed: false },
    { duration: 360, size: 128 * 1024 * 1024, allowed: true },
    { duration: 253, size: 128 * 1024 * 1024 + 1, allowed: false },
  ]
  for (const { duration, size, allowed } of cases) {
    // Boundary sizes without allocating 128 MiB for each state-validation test.
    const input = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' })
    Object.defineProperty(input, 'size', { value: size })
    let calls = 0
    const mixer = new MixerStore(); mixer.selectFile(input, 1); await settle()
    const engine: StemSeparationEngine = { separate: async () => { calls++; return separated() } }
    const store = new SeparationStore(engine, fakeCache(), mixer, capable)
    await store.initialize(); store.selectFile(input, 1); await store.start(duration)
    expect(calls, `${duration}s / ${size} bytes`).toBe(allowed ? 1 : 0)
    expect(store.getSnapshot().stage).toBe(allowed ? 'complete' : 'error')
    if (!allowed) expect(store.getSnapshot().errorCode).toBe('memory')
    store.clear(); mixer.clear()
  }
})
