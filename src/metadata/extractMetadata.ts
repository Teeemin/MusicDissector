import { parseBlob, selectCover } from 'music-metadata'
import { parseEmbeddedLyrics } from '../lyrics/LyricsParser'
import type { EmbeddedLyrics } from '../lyrics/types'
import type { MetadataResult } from './types'

function text(value?: string): string | null {
  return value?.replaceAll('\0', '').trim() || null
}

export async function extractMetadata(file: File): Promise<MetadataResult> {
  // Playback's HTMLAudioElement remains the authoritative duration. Do not scan
  // every MPEG frame just to calculate a second duration for large local files.
  const metadata = await parseBlob(file, { duration: false, skipCovers: false })
  const { common, format, native } = metadata
  const nativeLyrics: EmbeddedLyrics[] = []
  for (const tags of Object.values(native)) {
    for (const tag of tags) {
      if (!/^(?:SYLT|SLT|USLT|ULT|(?:TXXX:)?(?:LYRICS|UNSYNCEDLYRICS|SYNCEDLYRICS|UNSYNCHRONIZEDLYRICS)|©lyr)$/i.test(tag.id)) continue
      if (typeof tag.value === 'string') nativeLyrics.push({ text: tag.value })
      else if (tag.value && typeof tag.value === 'object') nativeLyrics.push(tag.value as EmbeddedLyrics)
    }
  }
  // Native strings preserve LRC offsets, repeated timestamps and original text,
  // which some common-tag conversions discard before reaching our parser.
  const lyrics = parseEmbeddedLyrics(nativeLyrics.length ? nativeLyrics : common.lyrics ?? [])
  const cover = selectCover(common.picture)
  const mime = cover?.format.toLowerCase().replace('image/jpg', 'image/jpeg')
  const artwork = cover && mime && /^image\/(?:jpeg|png|gif|webp|avif|bmp)$/.test(mime)
    ? { data: new Uint8Array(cover.data), format: mime } : null
  return {
    title: text(common.title),
    artist: text(common.artist),
    album: text(common.album),
    duration: Number.isFinite(format.duration) && format.duration! > 0 ? format.duration! : null,
    artwork,
    lyrics,
  }
}
