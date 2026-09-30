import scriptUrl from 'libflacjs/dist/libflac.min.wasm.js?url'
import wasmUrl from 'libflacjs/dist/libflac.min.wasm.wasm?url'
import type * as FlacModule from 'libflacjs/dist/index'

type Flac = typeof FlacModule
const scope = self as unknown as { Flac: Flac; FLAC_SCRIPT_LOCATION: Record<string, string> }
let codec: Flac
let encoder = 0
let metadata: FlacModule.StreamMetadata | undefined
let outputs: Uint8Array<ArrayBuffer>[] = []
self.onmessage = async ({ data }: MessageEvent<{ kind: 'init' | 'chunk' | 'finish'; frames: number; channels: number; rate: number; pcm: Int32Array<ArrayBuffer> }>) => {
  try {
    outputs = []
    if (data.kind === 'init') {
      scope.FLAC_SCRIPT_LOCATION = { 'libflac.min.wasm.wasm': wasmUrl }
      await import(/* @vite-ignore */ scriptUrl)
      codec = scope.Flac
      if (!codec.isReady()) await new Promise<void>(resolve => codec.on('ready', () => resolve()))
      encoder = codec.create_libflac_encoder(data.rate, data.channels, 24, 5, data.frames, true)
      if (!encoder || codec.init_encoder_stream(encoder, bytes => { outputs.push(bytes.slice()) }, info => { metadata = info }) !== 0) throw new Error('FLAC init')
    } else if (data.kind === 'chunk') {
      if (!codec.FLAC__stream_encoder_process_interleaved(encoder, data.pcm, data.frames)) throw new Error('FLAC encode')
    } else {
      if (!codec.FLAC__stream_encoder_finish(encoder)) throw new Error('FLAC finish')
      codec.FLAC__stream_encoder_delete(encoder); encoder = 0
    }
    self.postMessage({ outputs, metadata: data.kind === 'finish' ? metadata : undefined }, { transfer: outputs.map(v => v.buffer) })
  } catch { if (encoder) codec?.FLAC__stream_encoder_delete(encoder); encoder = 0; self.postMessage({ error: 'FLAC 인코딩 실패' }) }
}
