import { AudioBufferSource, BufferTarget, Mp3OutputFormat, Output, Quality, canEncodeAudio } from 'mediabunny'
import type { MetadataTags } from 'mediabunny'
import { registerMp3Encoder } from '@mediabunny/mp3-encoder'
import { EXPORT_SAMPLE_RATE, MixExportError } from './exportTypes'
import type { MixSnapshot } from './exportTypes'

const quality = new Quality({ bitrate: 320_000, bitrateMode: 'constant' })
let encoderReady: Promise<void> | null = null
async function initializeEncoder() {
  encoderReady ??= (async () => {
    const config = { numberOfChannels: 2, sampleRate: EXPORT_SAMPLE_RATE, quality }
    if (!await canEncodeAudio('mp3', config)) registerMp3Encoder()
    if (!await canEncodeAudio('mp3', config)) throw new MixExportError('encoder-init')
  })().catch(() => { encoderReady = null; throw new MixExportError('encoder-init') })
  return encoderReady
}

export async function encodeMp3(buffer: AudioBuffer, snapshot: MixSnapshot, artwork: Blob | null, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted()
  await initializeEncoder()
  signal.throwIfAborted()
  const tags: MetadataTags = { title: snapshot.title, artist: snapshot.artist ?? undefined, album: snapshot.album ?? undefined }
  if (artwork) tags.images = [{ data: new Uint8Array(await artwork.arrayBuffer()), mimeType: artwork.type, kind: 'coverFront' }]
  signal.throwIfAborted()
  const output = new Output({ format: new Mp3OutputFormat(), target: new BufferTarget() })
  let initialized = false
  const cancel = () => { void output.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const source = new AudioBufferSource({ codec: 'mp3', quality, onEncodedSample: () => { initialized = true; signal.throwIfAborted() } })
    output.addAudioTrack(source)
    output.setMetadataTags(tags)
    await output.start()
    signal.throwIfAborted()
    // AudioBufferSource consumes AudioBuffer through a bounded chunk iterator;
    // the official extension sends those chunks to its bundled WASM worker.
    await source.add(buffer)
    signal.throwIfAborted()
    await output.finalize()
    signal.throwIfAborted()
    const bytes = output.target.buffer
    if (!bytes?.byteLength) throw new MixExportError('encoding')
    try { return new Blob([bytes], { type: 'audio/mpeg' }) }
    catch { throw new MixExportError('download') }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof MixExportError) throw error
    throw new MixExportError(initialized ? 'encoding' : 'encoder-init')
  } finally {
    signal.removeEventListener('abort', cancel)
    if (output.state !== 'finalized') await output.cancel().catch(() => {})
  }
}
