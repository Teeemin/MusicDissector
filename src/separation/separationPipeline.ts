import { CHUNK_SAMPLES, OVERLAP, STEP, STEM_OUTPUT_ORDER, chunkCount } from './separationTypes'

export function buildChunk(left: Float32Array, right: Float32Array, index: number) {
  const start = index * STEP
  const length = Math.min(CHUNK_SAMPLES, left.length - start)
  const planar = new Float32Array(CHUNK_SAMPLES * 2)
  planar.set(left.subarray(start, start + length))
  planar.set(right.subarray(start, start + length), CHUNK_SAMPLES)
  return { planar, start, length }
}
export function overlapWeight(index: number, sample: number, total: number) {
  if (index > 0 && sample < OVERLAP) return sample / OVERLAP
  if (index < total - 1 && sample >= CHUNK_SAMPLES - OVERLAP) return 1 - (sample - (CHUNK_SAMPLES - OVERLAP)) / OVERLAP
  return 1
}
export function addChunk(outputs: Float32Array[], audio: Float32Array, index: number, length: number, totalSamples: number) {
  const start = index * STEP
  const total = chunkCount(totalSamples)
  for (let s = 0; s < STEM_OUTPUT_ORDER.length; s++) {
    for (let i = 0; i < length; i++) {
      const weight = overlapWeight(index, i, total)
      outputs[s][start + i] += audio[s * 2 * CHUNK_SAMPLES + i] * weight
      outputs[s][totalSamples + start + i] += audio[(s * 2 + 1) * CHUNK_SAMPLES + i] * weight
    }
  }
}
