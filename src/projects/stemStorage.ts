import { AUDIO_BLOCK, readWav, writeWav } from './wavStorage'
import type { StoredStem } from './projectTypes'
import type { StemId } from '../mixer/mixerTypes'
import type { StreamMetadata } from 'libflacjs/dist/index'

type Reply = { outputs: Uint8Array<ArrayBuffer>[]; metadata?: StreamMetadata; error?: string }
async function writeFlac(buffer: AudioBuffer, writer: FileSystemWritableFileStream, signal: AbortSignal) {
  const worker = new Worker(new URL('./flac.worker.ts', import.meta.url), { type: 'module' })
  const exchange = (data: object, transfer: Transferable[] = []) => new Promise<Reply>((resolve, reject) => {
    signal.throwIfAborted()
    const finish = (error?: Error, result?: Reply) => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(result!) }
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('FLAC 응답 시간 초과')), 15000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = event => { event.preventDefault(); finish(new Error('FLAC Worker 오류')) }
    worker.onmessage = ({ data: result }: MessageEvent<Reply>) => result.error ? finish(new Error(result.error)) : finish(undefined, result)
    worker.postMessage(data, transfer)
  })
  const write = async (reply: Reply) => { for (const chunk of reply.outputs) { signal.throwIfAborted(); await writer.write(chunk) } }
  try {
    await write(await exchange({ kind: 'init', frames: buffer.length, channels: buffer.numberOfChannels, rate: buffer.sampleRate }))
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    for (let start = 0; start < buffer.length; start += AUDIO_BLOCK) {
      signal.throwIfAborted()
      const n = Math.min(AUDIO_BLOCK, buffer.length - start)
      const pcm = new Int32Array(n * channels.length)
      for (let i = 0; i < n; i++) for (let ch = 0; ch < channels.length; ch++) {
        const sample = channels[ch][start + i]
        // Never silently clip floating-point inference output. WAV preserves headroom.
        if (!Number.isFinite(sample) || sample < -1 || sample >= 1) throw new Error('Float32 WAV required')
        pcm[i * channels.length + ch] = Math.min(8388607, Math.round(sample * 8388608))
      }
      await write(await exchange({ kind: 'chunk', frames: n, pcm }, [pcm.buffer]))
    }
    const last = await exchange({ kind: 'finish' }); await write(last)
    if (!last.metadata || last.metadata.total_samples !== buffer.length) throw new Error('Incomplete FLAC')
    // Patch STREAMINFO's frame sizes and MD5 after the streaming encoder finishes.
    const frameSizes = new Uint8Array(6)
    for (let i = 0; i < 3; i++) { frameSizes[i] = last.metadata.min_framesize >> (16 - i * 8); frameSizes[i + 3] = last.metadata.max_framesize >> (16 - i * 8) }
    const md5 = Uint8Array.from(last.metadata.md5sum.match(/../g) ?? [], v => parseInt(v, 16))
    if (md5.length !== 16) throw new Error('Invalid FLAC checksum')
    await writer.write({ type: 'write', position: 12, data: frameSizes })
    await writer.write({ type: 'write', position: 26, data: md5 })
  } finally { worker.terminate() }
}

export async function storeStem(dir: FileSystemDirectoryHandle, id: StemId, buffer: AudioBuffer, signal: AbortSignal): Promise<StoredStem> {
  let format: StoredStem['format'] = 'flac-pcm24'
  let filename = `${id}.flac`
  let handle = await dir.getFileHandle(filename, { create: true })
  let writer = await handle.createWritable()
  try {
    await writeFlac(buffer, writer, signal)
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    await dir.removeEntry(filename)
    signal.throwIfAborted()
    // Quota or filesystem failures won't be helped by a larger WAV.
    if (error instanceof DOMException && ['QuotaExceededError', 'NotAllowedError', 'NotFoundError'].includes(error.name)) throw error
    format = 'wav-float32'; filename = `${id}.wav`
    handle = await dir.getFileHandle(filename, { create: true }); writer = await handle.createWritable()
    try { await writeWav(buffer, writer, signal); await writer.close() }
    catch (failure) { await writer.abort().catch(() => {}); throw failure }
  }
  signal.throwIfAborted()
  return { format, file: filename, bytes: (await handle.getFile()).size, frames: buffer.length, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate }
}

export async function restoreStem(dir: FileSystemDirectoryHandle, info: StoredStem, signal: AbortSignal) {
  signal.throwIfAborted()
  const file = await (await dir.getFileHandle(info.file)).getFile()
  if (file.size !== info.bytes) throw new Error('저장된 stem 파일의 크기가 일치하지 않습니다.')
  if (info.format === 'wav-float32') return readWav(file, info, signal)
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (String.fromCharCode(...header) !== 'fLaC') throw new Error('저장된 FLAC이 손상되었습니다.')
  const context = new OfflineAudioContext(info.channels, 1, info.sampleRate)
  const buffer = await context.decodeAudioData(await file.arrayBuffer())
  signal.throwIfAborted()
  if (buffer.length !== info.frames || buffer.numberOfChannels !== info.channels || buffer.sampleRate !== info.sampleRate) throw new Error('저장된 stem 형식이 일치하지 않습니다.')
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const samples = buffer.getChannelData(ch)
    for (let start = 0; start < samples.length; start += AUDIO_BLOCK) {
      for (const sample of samples.subarray(start, start + AUDIO_BLOCK)) if (!Number.isFinite(sample)) throw new Error('저장된 오디오가 손상되었습니다.')
      if (start % (AUDIO_BLOCK * 32) === 0) { await new Promise(resolve => setTimeout(resolve, 0)); signal.throwIfAborted() }
    }
  }
  return buffer
}
