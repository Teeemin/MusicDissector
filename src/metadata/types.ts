import type { LyricsDocument } from '../lyrics/types'

export interface MetadataResult {
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  artwork: { data: Uint8Array<ArrayBuffer>; format: string } | null
  lyrics: LyricsDocument
}

export type MetadataResponse = { ok: true; result: MetadataResult } | { ok: false }
