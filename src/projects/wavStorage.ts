/** Bounded Float32 WAV fallback: no clipping or full-song encoded copy. */
export const AUDIO_BLOCK = 16384
export function wavHeader(frames: number, channels: number, rate: number) {
  const bytes = new Uint8Array(44)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + frames * channels * 4, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 3, true); view.setUint16(22, channels, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * channels * 4, true)
  view.setUint16(32, channels * 4, true); view.setUint16(34, 32, true); text(36, 'data'); view.setUint32(40, frames * channels * 4, true)
  return bytes
}
export async function writeWav(buffer: AudioBuffer, writer: FileSystemWritableFileStream, signal: AbortSignal) {
  await writer.write(wavHeader(buffer.length, buffer.numberOfChannels, buffer.sampleRate))
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  for (let start = 0; start < buffer.length; start += AUDIO_BLOCK) {
    signal.throwIfAborted()
    const n = Math.min(AUDIO_BLOCK, buffer.length - start)
    const bytes = new Uint8Array(n * channels.length * 4)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < n; i++) for (let ch = 0; ch < channels.length; ch++) {
      const sample = channels[ch][start + i]
      if (!Number.isFinite(sample)) throw new Error('유효하지 않은 stem 오디오입니다.')
      view.setFloat32((i * channels.length + ch) * 4, sample, true)
    }
    await writer.write(bytes)
  }
}
export async function readWav(file: File, info: { frames: number; channels: number; sampleRate: number }, signal: AbortSignal) {
  const header = new Uint8Array(await file.slice(0, 44).arrayBuffer())
  const expected = wavHeader(info.frames, info.channels, info.sampleRate)
  if (file.size !== 44 + info.frames * info.channels * 4 || header.some((v, i) => v !== expected[i])) throw new Error('저장된 WAV가 손상되었습니다.')
  const buffer = new AudioBuffer({ length: info.frames, numberOfChannels: info.channels, sampleRate: info.sampleRate })
  const channels = Array.from({ length: info.channels }, (_, i) => buffer.getChannelData(i))
  for (let start = 0; start < info.frames; start += AUDIO_BLOCK) {
    signal.throwIfAborted()
    const n = Math.min(AUDIO_BLOCK, info.frames - start)
    const view = new DataView(await file.slice(44 + start * info.channels * 4, 44 + (start + n) * info.channels * 4).arrayBuffer())
    for (let i = 0; i < n; i++) for (let ch = 0; ch < info.channels; ch++) {
      const sample = view.getFloat32((i * info.channels + ch) * 4, true)
      if (!Number.isFinite(sample)) throw new Error('저장된 오디오가 손상되었습니다.')
      channels[ch][start + i] = sample
    }
  }
  return buffer
}
