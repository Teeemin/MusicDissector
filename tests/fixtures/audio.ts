import { readFileSync } from 'node:fs'

export function frame(id: string, data: Buffer) {
  const header = Buffer.alloc(10)
  header.write(id)
  header.writeUInt32BE(data.length, 4)
  return Buffer.concat([header, data])
}

const utf16 = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
const textFrame = (id: string, text: string) => frame(id, Buffer.concat([Buffer.from([1]), utf16(text)]))

export interface TagOptions {
  title?: string
  artist?: string
  album?: string
  lyrics?: string
  synchronized?: { time: number; text: string }[]
  timestampFormat?: number
  artwork?: boolean
  brokenArtwork?: boolean
}

export function id3Tag(options: TagOptions = {}) {
  const frames: Buffer[] = []
  for (const [id, text] of [['TIT2', options.title], ['TPE1', options.artist], ['TALB', options.album]]) {
    if (text !== undefined) frames.push(textFrame(id!, text))
  }
  if (options.lyrics !== undefined) {
    frames.push(frame('USLT', Buffer.concat([Buffer.from([1]), Buffer.from('kor'), Buffer.from([0, 0]), utf16(options.lyrics)])))
  }
  if (options.synchronized) {
    const entries = options.synchronized.map(({ time, text }) => {
      const timestamp = Buffer.alloc(4)
      timestamp.writeUInt32BE(time)
      return Buffer.concat([utf16(text), Buffer.from([0, 0]), timestamp])
    })
    frames.push(frame('SYLT', Buffer.concat([Buffer.from([1]), Buffer.from('kor'), Buffer.from([options.timestampFormat ?? 2, 1, 0, 0]), ...entries])))
  }
  if (options.artwork || options.brokenArtwork) {
    const image = options.brokenArtwork ? Buffer.from('not a png') : readFileSync(new URL('../../public/icons/icon-192.png', import.meta.url))
    frames.push(frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0'), Buffer.from([3, 0]), image])))
  }
  const body = Buffer.concat(frames)
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0])
  let size = body.length
  for (let i = 9; i >= 6; i--) { header[i] = size & 0x7f; size >>>= 7 }
  return Buffer.concat([header, body])
}

function riffChunk(name: string, bytes: Buffer) {
  const header = Buffer.alloc(8)
  header.write(name)
  header.writeUInt32LE(bytes.length, 4)
  return Buffer.concat([header, bytes, Buffer.alloc(bytes.length % 2)])
}

/** PCM WAV with actual RIFF ID3 chunks. Chromium plays it; the worker reads it. */
export function taggedWav(options: TagOptions = {}, name = '파일 이름.wav', seconds = 40) {
  const sampleRate = 8000
  const format = Buffer.alloc(16)
  format.writeUInt16LE(1, 0)
  format.writeUInt16LE(1, 2)
  format.writeUInt32LE(sampleRate, 4)
  format.writeUInt32LE(sampleRate * 2, 8)
  format.writeUInt16LE(2, 12)
  format.writeUInt16LE(16, 14)
  const pcm = Buffer.alloc(seconds * sampleRate * 2)
  for (let i = 0; i < seconds * sampleRate; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 4000), i * 2)
  const contents = Buffer.concat([Buffer.from('WAVE'), riffChunk('fmt ', format), riffChunk('id3 ', id3Tag(options)), riffChunk('data', pcm)])
  return { name, mimeType: 'audio/wav', buffer: riffChunk('RIFF', contents) }
}

export function taggedMp3(options: TagOptions) {
  return {
    name: '태그 있는 음악.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.concat([id3Tag(options), readFileSync(new URL('./tone.mp3', import.meta.url))]),
  }
}
