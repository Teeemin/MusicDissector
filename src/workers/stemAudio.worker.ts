// This pinned upstream version's /webgpu entry uses native Asyncify, not JSEP.
// /all matches bs-roformer-web's ort.all build; ONLY the WebGPU EP is selected.
import * as ort from 'onnxruntime-web/all'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url'
import moduleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url'
import { stftStereo, istftBatch } from '../separation/dsp/stft'
import { addChunk, buildChunk } from '../separation/separationPipeline'
import { CHUNK_SAMPLES, SAMPLE_RATE, STFT_SETTINGS, STEM_OUTPUT_ORDER, chunkCount, classifyError, SeparationError } from '../separation/separationTypes'
import type { SeparationStage } from '../separation/separationTypes'

let session: ort.InferenceSession | null = null
let hidden = false
let resume: (() => void) | undefined
let gpuError: Error | null = null
const progress = (stage: SeparationStage, completed = 0, total = 0) => self.postMessage({ kind: 'progress', stage, completed, total })
self.onmessage = async ({ data }: MessageEvent<{ kind: string; file: File; left: Float32Array; right: Float32Array; hidden: boolean }>) => {
  if (data.kind === 'visibility') { hidden = data.hidden; if (!hidden) resume?.(); return }
  let phase: 'model-load' | 'inference' = 'model-load'
  try {
    if (data.kind === 'init') {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
      if (!adapter?.features.has('shader-f16') || adapter.limits.maxStorageBuffersPerShaderStage < 8) throw new SeparationError('unsupported')
      ort.env.webgpu.adapter = adapter
      ort.env.wasm.numThreads = 1
      ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: moduleUrl }
      ort.env.logLevel = 'warning'
      progress('model-loading')
      const bytes = new Uint8Array(await data.file.arrayBuffer())
      session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'disabled' })
      const device = await ort.env.webgpu.device
      device.addEventListener('uncapturederror', (event) => {
        gpuError = new Error(event.error.message)
        self.postMessage({ kind: 'error', code: classifyError(gpuError, 'inference'), detail: gpuError.message })
      })
      void device.lost.then((info) => {
        if (info.reason !== 'destroyed') self.postMessage({ kind: 'error', code: 'inference', detail: info.message })
      })
      if (!['spec_real', 'spec_imag'].every((n) => session!.inputNames.includes(n)) || !['out_spec_real', 'out_spec_imag'].every((n) => session!.outputNames.includes(n))) throw new Error('Wrong model contract')
      self.postMessage({ kind: 'ready' })
      return
    }
    if (data.kind !== 'separate' || !session) return
    phase = 'inference'
    const { left, right } = data
    const samples = left.length
    const total = chunkCount(samples)
    const outputs = STEM_OUTPUT_ORDER.map(() => new Float32Array(samples * 2))
    progress('separating', 0, total)
    for (let index = 0; index < total; index++) {
      if (hidden) await new Promise<void>((resolve) => { resume = resolve })
      const { planar, length } = buildChunk(left, right, index)
      const { real, imag, F, T } = stftStereo(planar, STFT_SETTINGS)
      if (F !== 1025 || T !== 345) throw new Error('Wrong STFT shape')
      const inputReal = new ort.Tensor('float32', real, [1, 2, F, T])
      const inputImag = new ort.Tensor('float32', imag, [1, 2, F, T])
      let tensors: ort.InferenceSession.ReturnType | undefined
      try {
        tensors = await session.run({ spec_real: inputReal, spec_imag: inputImag })
        if (gpuError) throw gpuError
        const realOut = tensors.out_spec_real
        const imagOut = tensors.out_spec_imag
        if (realOut.type !== 'float32' || imagOut.type !== 'float32' || realOut.size !== 6 * 2 * F * T || imagOut.size !== realOut.size) throw new Error('Wrong output shape')
        // ORT-owned arrays are read locally. No extra spectrogram copies or worker pools.
        const realData = realOut.data as Float32Array<ArrayBuffer>
        const imagData = imagOut.data as Float32Array<ArrayBuffer>
        const audio = istftBatch({ realBuf: realData.buffer, imagBuf: imagData.buffer, numStems: 6, numChannels: 2, F, T, length: CHUNK_SAMPLES, ...STFT_SETTINGS,
          realOffset: realData.byteOffset, imagOffset: imagData.byteOffset })
        addChunk(outputs, new Float32Array(audio.audioBuf), index, length, samples)
      } finally { inputReal.dispose(); inputImag.dispose(); if (tensors) Object.values(tensors).forEach((t) => t.dispose()) }
      progress('separating', index + 1, total)
    }
    progress('post-processing', total, total)
    // Reject invalid numerical output instead of silently producing broken audio.
    for (const output of outputs) for (const value of output) if (!Number.isFinite(value)) throw new Error('Non-finite stem output')
    if ((left.some((v) => Math.abs(v) > 1e-5) || right.some((v) => Math.abs(v) > 1e-5)) && !outputs.some((a) => a.some((v) => Math.abs(v) > 1e-8))) throw new Error('Unexpected silent model output')
    await session.release(); session = null
    self.postMessage({ kind: 'result', outputs, sampleRate: SAMPLE_RATE }, { transfer: outputs.map((a) => a.buffer) })
  } catch (error) {
    await session?.release().catch(() => {}); session = null
    self.postMessage({ kind: 'error', code: classifyError(error, phase), detail: String(error) })
  }
}
